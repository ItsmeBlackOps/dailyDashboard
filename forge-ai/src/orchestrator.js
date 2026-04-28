import fs from 'node:fs';
import path from 'node:path';
import {
  runAuthor,
  runJDCritic,
  runJDReviser,
  runRealismCritic,
  runRealismReviser,
} from './agents.js';
import { polish } from './polish.js';

const MAX_OUTER_ITERATIONS = 5;
const MAX_JD_INNER_TRIES = 2;
const DEFACTO_JD_PASS_SCORE = 85;
const DEFACTO_REALISM_PASS_SCORE = 80;
const STUCK_DELTA = 3;

function filterFalsePositives(missing, resume) {
  if (!missing || missing.length === 0) return [];
  const hay = JSON.stringify(resume).toLowerCase();
  return missing.filter((kw) => {
    const token = String(kw).toLowerCase().split(/\s+/)[0];
    return !hay.includes(token);
  });
}

// Normalize JD critique: if a rubric dimension is below 20 but no corresponding issue
// was cited, raise it. The critic silently deducts on E despite empty weak_bullets;
// this enforces self-consistency deterministically.
function normalizeJdCritique(critique, resume) {
  if (!critique || !critique.breakdown) return critique;
  const b = { ...critique.breakdown };
  const weak = critique.weak_bullets || [];
  const missing = filterFalsePositives(critique.missing_keywords || [], resume);
  const summary = critique.summary_issues || [];
  const banned = critique.banned_word_hits || [];

  // A: tied to missing_keywords
  if (b.A < 20 && missing.length === 0) b.A = 20;
  // B: tied to summary_issues + banned_word_hits
  if (b.B < 20 && summary.length === 0 && banned.length === 0) b.B = 20;
  // D: tied to weak_bullets citing "no number" / "round number"
  const dIssues = weak.filter((w) =>
    /number|quant|round/i.test((w.issue || '') + (w.suggestion || ''))
  );
  if (b.D < 20 && dIssues.length === 0) b.D = 20;
  // E: tied to weak_bullets citing verb/opener issues OR banned_word_hits
  const eIssues = weak.filter((w) =>
    /verb|opener|action|parse|ats/i.test((w.issue || '') + (w.suggestion || ''))
  );
  if (b.E < 20 && eIssues.length === 0 && banned.length === 0) b.E = 20;
  // C: tied to weak_bullets citing ordering
  const cIssues = weak.filter((w) => /order|first bullet|relevance/i.test((w.issue || '')));
  if (b.C < 20 && cIssues.length === 0) b.C = 20;

  const newScore = (b.A || 0) + (b.B || 0) + (b.C || 0) + (b.D || 0) + (b.E || 0);
  return { ...critique, breakdown: b, score: newScore };
}

function defactoJdPass(critique, resume) {
  if (!critique) return false;
  const noCriticals = !(critique.weak_bullets || []).some((b) => b.severity === 'critical');
  const realMissing = filterFalsePositives(critique.missing_keywords || [], resume);
  const missingOk = realMissing.length === 0;
  if (critique.verdict === 'pass' && missingOk) return true;
  return (critique.score ?? 0) >= DEFACTO_JD_PASS_SCORE && noCriticals && missingOk;
}

function defactoRealismPass(critique) {
  if (!critique) return false;
  if (critique.verdict === 'pass') return true;
  const noCriticals = !(critique.red_flags || []).some((f) => f.severity === 'critical');
  return (critique.realism_score ?? 0) >= DEFACTO_REALISM_PASS_SCORE && noCriticals;
}

function writeArtifact(traceDir, name, data) {
  fs.writeFileSync(path.join(traceDir, name), JSON.stringify(data, null, 2));
}

function appendScores(traceDir, row) {
  const p = path.join(traceDir, 'scores.md');
  if (!fs.existsSync(p)) {
    fs.writeFileSync(
      p,
      '| Iter | Stage | JD Score | JD Verdict | Realism Score | Realism Verdict | Notes |\n' +
        '|------|-------|----------|-----------|---------------|-----------------|-------|\n'
    );
  }
  fs.appendFileSync(
    p,
    `| ${row.iter} | ${row.stage} | ${row.jd_score ?? '-'} | ${row.jd_verdict ?? '-'} | ${row.realism_score ?? '-'} | ${row.realism_verdict ?? '-'} | ${row.notes ?? ''} |\n`
  );
}

export async function generate({ jd_text, candidate, traceDir, mustHaves = [] }) {
  fs.mkdirSync(traceDir, { recursive: true });
  fs.writeFileSync(path.join(traceDir, 'trace.jsonl'), '');
  writeArtifact(traceDir, 'input-jd.txt', jd_text);
  writeArtifact(traceDir, 'input-candidate.json', candidate);

  console.log('[forge] Agent 1: authoring initial resume...');
  let resume = await runAuthor({ jd_text, candidate, traceDir });
  writeArtifact(traceDir, 'iter-0-author.json', resume);
  appendScores(traceDir, { iter: 0, stage: 'author', notes: 'initial generation' });

  const history = [];
  let lastJdCritique = null;
  let lastRealismCritique = null;

  for (let outer = 1; outer <= MAX_OUTER_ITERATIONS; outer++) {
    console.log(`[forge] Outer iteration ${outer}/${MAX_OUTER_ITERATIONS}`);

    // Inner JD match loop
    for (let inner = 1; inner <= MAX_JD_INNER_TRIES; inner++) {
      console.log(`[forge]   Agent 2: JD critic (try ${inner})...`);
      const rawCritique = await runJDCritic({ jd_text, resume, traceDir, mustHaves });
      lastJdCritique = normalizeJdCritique(rawCritique, resume);
      if (lastJdCritique.score !== rawCritique.score) {
        console.log(`[forge]     score normalized ${rawCritique.score} → ${lastJdCritique.score} (silent deductions removed)`);
      }
      writeArtifact(traceDir, `iter-${outer}-jd-critique-${inner}.json`, lastJdCritique);
      appendScores(traceDir, {
        iter: outer,
        stage: `jd-critic-${inner}`,
        jd_score: lastJdCritique.score,
        jd_verdict: lastJdCritique.verdict,
      });

      if (defactoJdPass(lastJdCritique, resume)) {
        console.log(`[forge]   JD critic: de-facto pass (score=${lastJdCritique.score}, verdict=${lastJdCritique.verdict}).`);
        break;
      }

      console.log(`[forge]   Agent 3: JD reviser (score=${lastJdCritique.score})...`);
      resume = await runJDReviser({ jd_text, resume, critique: lastJdCritique, traceDir });
      writeArtifact(traceDir, `iter-${outer}-jd-revised-${inner}.json`, resume);
      appendScores(traceDir, { iter: outer, stage: `jd-revised-${inner}` });
    }

    // Realism check
    console.log('[forge]   Agent 4: realism critic...');
    lastRealismCritique = await runRealismCritic({ resume, candidate, traceDir });
    writeArtifact(traceDir, `iter-${outer}-realism-critique.json`, lastRealismCritique);
    appendScores(traceDir, {
      iter: outer,
      stage: 'realism-critic',
      realism_score: lastRealismCritique.realism_score,
      realism_verdict: lastRealismCritique.verdict,
    });

    history.push({
      iter: outer,
      resume,
      jd_score: lastJdCritique.score,
      realism_score: lastRealismCritique.realism_score,
      jd_pass: lastJdCritique.verdict === 'pass',
      realism_pass: lastRealismCritique.verdict === 'pass',
    });

    if (defactoJdPass(lastJdCritique, resume) && defactoRealismPass(lastRealismCritique)) {
      console.log('[forge] ✓ Both critics passed (de-facto). Running polish pass...');
      const polishResult = await polish(resume, { traceDir });
      resume = polishResult.resume;
      writeArtifact(traceDir, 'polish-fixes.json', polishResult.fixes);
      writeArtifact(traceDir, 'resume-final.json', resume);
      writeArtifact(traceDir, 'history.json', history);
      console.log(`[forge]   Polish applied ${polishResult.fixes.filter(f => f.to).length} fixes.`);
      return { resume, history, reason: 'both_passed', iterations: outer };
    }

    // Stuck-realism guard: if realism score has moved < STUCK_DELTA for 2 iters, stop burning tokens
    if (history.length >= 2) {
      const recent = history.slice(-2).map((h) => h.realism_score || 0);
      if (Math.abs(recent[0] - recent[1]) < STUCK_DELTA && recent[1] < DEFACTO_REALISM_PASS_SCORE) {
        console.log(`[forge] ⚠ Realism score stuck at ~${recent[1]} for 2 iters. Terminating early.`);
        const best = pickBest(history);
        const polishResult = await polish(best.resume, { traceDir });
        writeArtifact(traceDir, 'polish-fixes.json', polishResult.fixes);
        writeArtifact(traceDir, 'resume-final.json', polishResult.resume);
        writeArtifact(traceDir, 'history.json', history);
        return { resume: polishResult.resume, history, reason: 'realism_stuck', iterations: outer };
      }
    }

    console.log(
      `[forge]   Agent 5: realism reviser (realism=${lastRealismCritique.realism_score})...`
    );
    resume = await runRealismReviser({
      resume,
      critique: lastRealismCritique,
      candidate,
      traceDir,
    });
    writeArtifact(traceDir, `iter-${outer}-realism-revised.json`, resume);
    appendScores(traceDir, { iter: outer, stage: 'realism-revised' });
  }

  console.log('[forge] ⚠ Max iterations reached — picking best from history.');
  const best = pickBest(history);
  const polishResult = await polish(best.resume, { traceDir });
  writeArtifact(traceDir, 'polish-fixes.json', polishResult.fixes);
  writeArtifact(traceDir, 'resume-final.json', polishResult.resume);
  writeArtifact(traceDir, 'history.json', history);
  return { resume: polishResult.resume, history, reason: 'max_iterations', iterations: MAX_OUTER_ITERATIONS };
}

function pickBest(history) {
  return history.slice().sort((a, b) => {
    const aPass = (a.jd_pass ? 1 : 0) + (a.realism_pass ? 1 : 0);
    const bPass = (b.jd_pass ? 1 : 0) + (b.realism_pass ? 1 : 0);
    if (aPass !== bPass) return bPass - aPass;
    const aTot = (a.jd_score || 0) + (a.realism_score || 0);
    const bTot = (b.jd_score || 0) + (b.realism_score || 0);
    return bTot - aTot;
  })[0];
}
