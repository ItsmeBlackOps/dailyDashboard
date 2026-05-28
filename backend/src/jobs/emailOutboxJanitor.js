// PRT Phase 5 — emailOutbox janitor.
//
// Daily sweep that deletes TERMINAL rows (status in [sent, failed])
// older than 30 days. In-flight rows (pending, sending) are NEVER
// touched — that's the worker's domain.
//
// Why not a Mongo TTL?
//   - We want observability (per-run log line, per-run count).
//   - We want an on-demand "_tick" export for tests / a future admin
//     endpoint.
//   - The TTL index alternative would be a partialFilterExpression on
//     {status:{$in:['sent','failed']}} keyed on updatedAt; it works but
//     gives zero visibility into how many rows actually got swept.

import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const DAILY_MS = 24 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 5 * 60 * 1000; // give the app a chance to settle
const DEFAULT_RETENTION_DAYS = 30;

let scheduled = null;
let interval = null;

function retentionMs() {
  return DEFAULT_RETENTION_DAYS * DAILY_MS;
}

async function tick(nowOverride) {
  const now = nowOverride instanceof Date ? nowOverride : new Date();
  const db = database.getDb();
  if (!db) {
    logger.warn('emailOutboxJanitor tick skipped — DB not ready');
    return { deleted: 0 };
  }
  const cutoff = new Date(now.getTime() - retentionMs());
  const collection = db.collection('emailOutbox');
  try {
    const result = await collection.deleteMany({
      status: { $in: ['sent', 'failed'] },
      updatedAt: { $lt: cutoff }
    });
    const deleted = result?.deletedCount || 0;
    if (deleted > 0) {
      logger.info('emailOutboxJanitor tick complete', {
        deleted,
        cutoff: cutoff.toISOString(),
        retentionDays: DEFAULT_RETENTION_DAYS
      });
    } else {
      logger.debug('emailOutboxJanitor tick — nothing to sweep', {
        cutoff: cutoff.toISOString()
      });
    }
    return { deleted };
  } catch (err) {
    logger.error('emailOutboxJanitor tick failed', { error: err.message });
    return { deleted: 0, error: err.message };
  }
}

export function startEmailOutboxJanitor() {
  if (scheduled || interval) {
    logger.warn('emailOutboxJanitor already started — ignoring duplicate start');
    return;
  }
  logger.info('emailOutboxJanitor scheduled', {
    retentionDays: DEFAULT_RETENTION_DAYS,
    startupDelayMs: STARTUP_DELAY_MS,
    intervalMs: DAILY_MS
  });
  scheduled = setTimeout(() => {
    scheduled = null;
    tick().catch((err) =>
      logger.error('emailOutboxJanitor first tick threw', { error: err.message })
    );
    interval = setInterval(() => {
      tick().catch((err) =>
        logger.error('emailOutboxJanitor tick threw', { error: err.message })
      );
    }, DAILY_MS);
  }, STARTUP_DELAY_MS);
}

export function stopEmailOutboxJanitor() {
  if (scheduled) {
    clearTimeout(scheduled);
    scheduled = null;
  }
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

// Exported for tests + a future admin "run-now" endpoint.
export const _tick = tick;
export const RETENTION_DAYS = DEFAULT_RETENTION_DAYS;
