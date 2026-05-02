/**
 * Per-minute cron that fires Apify runs for candidates whose
 * scheduleSlotMinute matches the current UTC minute. Spreads 317
 * candidates evenly across the hour so concurrency stays under
 * PER_CAND_SCRAPE_CONCURRENCY.
 *
 * Default OFF. Opt in with PER_CAND_SCRAPE_ENABLED=1.
 */
import { perCandidateScrapeService } from '../services/perCandidateScrapeService.js';
import { logger } from '../utils/logger.js';

const STARTUP_DELAY_MS = 90 * 1000; // 90s after boot so DB + scraper settle
const TICK_INTERVAL_MS = 60 * 1000; // every minute

let inFlight = false;
let interval = null;

async function tick() {
  if (inFlight) {
    logger.warn('perCandidateScrape: previous tick still running, skipping');
    return;
  }
  inFlight = true;
  const start = Date.now();
  try {
    const r = await perCandidateScrapeService.tickForCurrentMinute();
    if (r.totalInSlot > 0) {
      logger.info('perCandidateScrape: tick complete', {
        ms: Date.now() - start,
        ...r,
      });
    }
  } catch (err) {
    logger.error('perCandidateScrape: tick failed', { error: err.message });
  } finally {
    inFlight = false;
  }
}

export function startPerCandidateScrapeScheduler() {
  if (interval) {
    logger.warn('perCandidateScrape: scheduler already started');
    return;
  }
  if (process.env.PER_CAND_SCRAPE_ENABLED !== '1') {
    logger.info('perCandidateScrape: disabled (set PER_CAND_SCRAPE_ENABLED=1 to opt in)');
    return;
  }
  if (!process.env.APIFY_TOKEN) {
    logger.warn('perCandidateScrape: APIFY_TOKEN missing — scheduler not started');
    return;
  }

  setTimeout(() => { tick(); }, STARTUP_DELAY_MS);
  interval = setInterval(tick, TICK_INTERVAL_MS);
  logger.info('perCandidateScrape scheduler started', {
    bootDelaySec: STARTUP_DELAY_MS / 1000,
    tickIntervalSec: TICK_INTERVAL_MS / 1000,
  });
}

export const _tick = tick;
