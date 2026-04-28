#!/usr/bin/env node
/**
 * Retry failed ResumeForge tailor calls — sequential, with retry/backoff.
 * Reads existing job-N.json files; any with `_error` field is re-attempted.
 * Successful retries overwrite the error stub.
 *
 * Usage: node scripts/retry-failed.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const TAILOR_API = process.env.TAILOR_API || 'https://resumeforge.silverspace.tech/tailor';
const CANDIDATE_PATH = path.join(ROOT, 'test-data', 'candidate-rathin-forge.json');
const JOBS_PATH = path.join(ROOT, 'test-data', 'jobs-live.json');
const OUT_DIR = path.join(ROOT, 'output', 'live-tailored');

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 30_000;       // 30s, 60s, 90s
const HTTP_TIMEOUT_MS = 270_000;      // 4.5 min — covers all but the worst tail

const candidate = JSON.parse(fs.readFileSync(CANDIDATE_PATH, 'utf-8'));
const jobs = JSON.parse(fs.readFileSync(JOBS_PATH, 'utf-8'));

// Find which jobs are currently in error state (or missing)
const failed = jobs.filter((j) => {
  const file = path.join(OUT_DIR, `${j.id}.json`);
  if (!fs.existsSync(file)) return true;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (data._error) return true;
    if (!data.resume) return true;
    if (fs.statSync(file).size < 1024) return true;
    return false;
  } catch {
    return true;
  }
});

console.log('');
console.log('ResumeForge retry pass');
console.log(`  ${failed.length} failed jobs to retry`);
console.log(`  serial (concurrency=1), max ${MAX_RETRIES} attempts each, exponential backoff`);
console.log('');

if (failed.length === 0) {
  console.log('Nothing to retry. Exiting.');
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tailorOnce(job, attempt) {
  const body = {
    candidate,
    jd_text: job.jd_text,
    must_haves: job.must_haves || [],
  };
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(TAILOR_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    const ms = ((Date.now() - t0) / 1000).toFixed(1);
    return { ok: false, error: `network/timeout (${ms}s): ${err.message}` };
  }

  const ms = ((Date.now() - t0) / 1000).toFixed(1);
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `HTTP ${res.status} (${ms}s): ${text.slice(0, 200)}` };
  }
  const data = await res.json();
  if (!data?.resume) {
    return { ok: false, error: `response missing resume field (${ms}s)` };
  }
  return { ok: true, data, latencyS: ms };
}

let succeeded = 0;
let stillFailed = 0;

for (const job of failed) {
  console.log(`[RETRY] ${job.id} - ${job.title} @ ${job.company}`);
  let ok = false;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await tailorOnce(job, attempt);
    if (result.ok) {
      const filePath = path.join(OUT_DIR, `${job.id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(result.data, null, 2));
      const cov = Math.round((result.data.keyword_coverage?.coverage || 0) * 100);
      const iters = result.data.meta?.iterations || '?';
      console.log(`  attempt ${attempt}: SUCCESS in ${result.latencyS}s | coverage=${cov}% | iterations=${iters}`);
      ok = true;
      break;
    }
    console.log(`  attempt ${attempt}: ${result.error}`);
    if (attempt < MAX_RETRIES) {
      const wait = BASE_BACKOFF_MS * attempt;
      console.log(`  waiting ${wait/1000}s before retry...`);
      await sleep(wait);
    }
  }
  if (ok) {
    succeeded++;
  } else {
    stillFailed++;
    // keep the error file so the next run can retry again
  }
  // Pause between jobs to give nginx some breathing room
  if (job !== failed[failed.length - 1]) await sleep(5000);
}

console.log('');
console.log('==========================================================');
console.log(`Retry complete: ${succeeded} recovered, ${stillFailed} still failing`);
console.log('==========================================================');
