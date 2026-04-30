/**
 * Scheduled jobsPool importer.
 *
 * Polls Apify for newly-completed actor runs at a fixed interval and
 * pipes them through the same import-apify-runs.js script the user
 * runs by hand. Idempotent (dedupeKey) so re-imports are cheap.
 *
 * Default OFF. Opt in with JOBS_POOL_IMPORT_ENABLED=1.
 *
 * Tunables:
 *   JOBS_POOL_IMPORT_INTERVAL_HOURS   how often to poll        (default 6)
 *   JOBS_POOL_IMPORT_LOOKBACK_HOURS   --since= window          (default 26 — 4h overlap on a 24h cadence)
 *   JOBS_POOL_IMPORT_CONCURRENCY      enrich-jd concurrency    (default 3)
 *   JOBS_POOL_IMPORT_LIMIT            max runs per cycle       (default 200)
 *   JOBS_POOL_IMPORT_ENRICH           on|off                   (default on)
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const STARTUP_DELAY_MS = 60 * 1000;     // 60s after boot so DB + scraper settle
const HOUR = 60 * 60 * 1000;

let inFlight = false;
let interval = null;

function runImporter() {
  if (inFlight) {
    logger.warn('jobsPoolImport: previous cycle still running, skipping');
    return;
  }
  const lookbackHours = parseInt(process.env.JOBS_POOL_IMPORT_LOOKBACK_HOURS || '26', 10);
  const concurrency   = parseInt(process.env.JOBS_POOL_IMPORT_CONCURRENCY    || '3', 10);
  const limit         = parseInt(process.env.JOBS_POOL_IMPORT_LIMIT          || '200', 10);
  const enrich        = (process.env.JOBS_POOL_IMPORT_ENRICH || 'on').toLowerCase();

  const sinceIso = new Date(Date.now() - lookbackHours * HOUR).toISOString().slice(0, 10);

  // Resolve the script path relative to the running backend bundle.
  // backend/src/jobs/jobsPoolImportScheduler.js → ../../scripts/import-apify-runs.js
  const scriptPath = path.resolve(__dirname, '..', '..', 'scripts', 'import-apify-runs.js');

  const args = [
    scriptPath,
    `--since=${sinceIso}`,
    `--limit=${limit}`,
    `--concurrency=${concurrency}`,
    `--enrich=${enrich}`,
  ];

  logger.info('jobsPoolImport: cycle starting', { sinceIso, limit, concurrency, enrich });
  inFlight = true;
  const start = Date.now();

  const child = spawn('node', args, {
    cwd: path.resolve(__dirname, '..', '..'),  // backend/
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit'],   // forward to backend logs
  });

  child.on('exit', (code) => {
    inFlight = false;
    const ms = Date.now() - start;
    if (code === 0) {
      logger.info('jobsPoolImport: cycle complete', { ms });
    } else {
      logger.error('jobsPoolImport: cycle exited non-zero', { code, ms });
    }
  });

  child.on('error', (err) => {
    inFlight = false;
    logger.error('jobsPoolImport: child process failed to start', { error: err.message });
  });
}

export function startJobsPoolImportScheduler() {
  if (interval) {
    logger.warn('jobsPoolImport: scheduler already started');
    return;
  }
  if (process.env.JOBS_POOL_IMPORT_ENABLED !== '1') {
    logger.info('jobsPoolImport: disabled (set JOBS_POOL_IMPORT_ENABLED=1 to opt in)');
    return;
  }

  const intervalHours = Math.max(
    1,
    parseInt(process.env.JOBS_POOL_IMPORT_INTERVAL_HOURS || '6', 10)
  );

  // Boot run with delay so DB / scraper settle.
  setTimeout(() => {
    runImporter();
  }, STARTUP_DELAY_MS);

  // Then every N hours.
  interval = setInterval(runImporter, intervalHours * HOUR);

  logger.info('jobsPoolImport scheduler started', {
    bootDelaySec: STARTUP_DELAY_MS / 1000,
    intervalHours,
  });
}

// Test/admin entry point for manual triggers.
export const _runImporter = runImporter;
