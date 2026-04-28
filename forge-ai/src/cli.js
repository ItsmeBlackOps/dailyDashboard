#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { generate } from './orchestrator.js';
import { validate, validateKeywordCoverage, formatReport, validateFile } from './validator.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function usage() {
  console.log(`
forge — ResumeForge AI multi-agent pipeline

USAGE
  forge test     --candidate <path.json> --jd <path.txt> [--out <dir>]
  forge validate <resume.json>
  forge help

ENV
  OPENAI_API_KEY   required
  FORGE_MODEL      optional (default: gpt-4o-mini)

EXAMPLES
  forge test --candidate candidates/vaibhav.json --jd jds/acme-de.txt
  forge validate output/vaibhav-acme/resume-final.json
`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!cmd || cmd === 'help' || args.help) {
    usage();
    return;
  }

  if (cmd === 'test') {
    if (!args.candidate || !args.jd) {
      console.error('error: --candidate and --jd are required');
      usage();
      process.exit(1);
    }

    const candidate = JSON.parse(fs.readFileSync(args.candidate, 'utf8'));
    const jd_text = fs.readFileSync(args.jd, 'utf8');
    const sidecarPath = args.jd.replace(/\.txt$/, '.must_haves.json');
    const mustHaves = fs.existsSync(sidecarPath)
      ? JSON.parse(fs.readFileSync(sidecarPath, 'utf8'))
      : candidate.jd_must_haves_for_test || [];

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const candidateSlug = candidate.slug || path.basename(args.candidate, '.json');
    const jdSlug = path.basename(args.jd, '.txt');
    const traceDir =
      args.out || path.join(process.cwd(), 'output', `${candidateSlug}__${jdSlug}__${stamp}`);

    console.log(`[forge] Trace dir: ${traceDir}`);

    const result = await generate({ jd_text, candidate, traceDir, mustHaves });

    console.log('\n[forge] === DONE ===');
    console.log(`  reason:     ${result.reason}`);
    console.log(`  iterations: ${result.iterations}`);
    console.log(`  final:      ${path.join(traceDir, 'resume-final.json')}`);

    console.log('\n[forge] Running rule-based validator on final output...');
    const v = validate(result.resume);
    console.log(formatReport(v));
    fs.writeFileSync(path.join(traceDir, 'validation.txt'), formatReport(v));

    if (mustHaves && mustHaves.length) {
      const cov = validateKeywordCoverage(result.resume, mustHaves);
      console.log(`\n[forge] Keyword coverage: ${(cov.coverage * 100).toFixed(0)}% (${cov.hits.length}/${cov.hits.length + cov.misses.length})`);
      if (cov.misses.length) console.log(`  Misses: ${cov.misses.join(', ')}`);
    }
    return;
  }

  if (cmd === 'validate') {
    const target = args._[0];
    if (!target) {
      console.error('error: validate requires a path');
      process.exit(1);
    }
    const v = validateFile(target);
    console.log(formatReport(v));
    process.exit(v.pass ? 0 : 1);
  }

  console.error(`unknown command: ${cmd}`);
  usage();
  process.exit(1);
}

main().catch((e) => {
  console.error('[forge] FATAL:', e.message);
  if (process.env.FORGE_DEBUG) console.error(e.stack);
  process.exit(1);
});
