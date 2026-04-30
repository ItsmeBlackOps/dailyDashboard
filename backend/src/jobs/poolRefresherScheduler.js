/**
 * Pool refresher scheduler — kicks off Apify actor runs on a cadence
 * so the importer has fresh dataset items to ingest.
 *
 * Two independent loops:
 *   - Fantastic Jobs: every JOBS_POOL_REFRESH_FANTASTIC_HOURS (default 6),
 *     uses datePostedAfter from poolRefresherState
 *   - LinkedIn:       every JOBS_POOL_REFRESH_LINKEDIN_HOURS (default 1),
 *     uses timeRange=1h
 *
 * Default OFF. Opt in with JOBS_POOL_REFRESH_ENABLED=1.
 */
import { logger } from '../utils/logger.js';
import { poolRefresherService } from '../services/poolRefresherService.js';

const HOUR = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 90 * 1000;

let timers = [];

function safeRun(label, fn) {
  return Promise.resolve(fn())
    .then((r) => logger.info(`poolRefresher.${label} ok`, r))
    .catch((err) => logger.error(`poolRefresher.${label} failed`, { error: err.message }));
}

export function startPoolRefresherScheduler() {
  if (timers.length > 0) {
    logger.warn('poolRefresher: scheduler already started');
    return;
  }
  if (process.env.JOBS_POOL_REFRESH_ENABLED !== '1') {
    logger.info('poolRefresher: disabled (set JOBS_POOL_REFRESH_ENABLED=1 to opt in)');
    return;
  }

  const fjHours = Math.max(0.25, parseFloat(process.env.JOBS_POOL_REFRESH_FANTASTIC_HOURS || '6'));
  const liHours = Math.max(0.25, parseFloat(process.env.JOBS_POOL_REFRESH_LINKEDIN_HOURS  || '1'));

  // Boot delay so DB / scraper / import-scheduler settle.
  setTimeout(() => {
    safeRun('fantastic', () => poolRefresherService.triggerFantasticJobs());
    safeRun('linkedin',  () => poolRefresherService.triggerLinkedIn());
  }, STARTUP_DELAY_MS);

  timers.push(setInterval(() => {
    safeRun('fantastic', () => poolRefresherService.triggerFantasticJobs());
  }, fjHours * HOUR));

  timers.push(setInterval(() => {
    safeRun('linkedin', () => poolRefresherService.triggerLinkedIn());
  }, liHours * HOUR));

  logger.info('poolRefresher scheduler started', {
    fantasticEveryHours: fjHours,
    linkedinEveryHours:  liHours,
    bootDelaySec: STARTUP_DELAY_MS / 1000,
  });
}
