// Buffered writer for the `perfMetrics` collection.
//
// Previously the response-timing middleware did one `insertOne` per /api
// request on `res.finish`. Under load that is one DB round-trip for every
// request the app serves — pure write amplification that competes with real
// query traffic and inflates p99 on the very requests it is trying to
// measure.
//
// This module batches those writes: the middleware calls `recordPerfMetric`
// (a synchronous in-memory push) and a single interval flush drains the
// buffer with one `insertMany`. A near-full buffer also triggers an early
// flush so traffic bursts don't overflow. The collection self-prunes via the
// 7-day TTL index on `createdAt` (see ensurePerfIndexes.js), so the buffer
// never needs to worry about retention.
//
// Trade-off: the perfMetrics dashboard (routes/index.js) may lag real time by
// up to FLUSH_INTERVAL_MS. That is acceptable for an operational metrics view.
// If the DB is unreachable, metrics are dropped (never re-buffered) so a slow
// or down database can't grow this buffer without bound.

import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const FLUSH_INTERVAL_MS = 5000; // drain at least every 5s
const MAX_BATCH = 500; // rows per insertMany
const MAX_BUFFER = 5000; // hard cap; drop oldest beyond this
const EARLY_FLUSH_AT = 200; // flush early once the buffer reaches this size

let buffer = [];
let interval = null;
let flushing = false;
let dropped = 0;

// Push one metric doc onto the buffer. Synchronous and allocation-cheap so it
// adds no latency to the request it measures. Bounds memory by dropping the
// oldest rows if the buffer is saturated (e.g. DB unreachable).
export function recordPerfMetric(doc) {
  if (!doc) return;
  buffer.push(doc);
  if (buffer.length > MAX_BUFFER) {
    const overflow = buffer.length - MAX_BUFFER;
    buffer.splice(0, overflow);
    dropped += overflow;
  }
  if (buffer.length >= EARLY_FLUSH_AT && !flushing) {
    // Fire-and-forget early flush. flush() swallows DB errors internally,
    // but guard here too so a throw from getDb() can never surface as an
    // unhandled rejection on the request hot path.
    flush().catch(() => {});
  }
}

// Drain the buffer into the DB. Splices a batch synchronously BEFORE awaiting
// so concurrent pushes during the insert land safely in the shortened buffer.
export async function flush() {
  if (flushing) return { inserted: 0 };
  if (buffer.length === 0) {
    if (dropped > 0) {
      logger.warn('perfMetricsBuffer dropped metrics while saturated', { dropped });
      dropped = 0;
    }
    return { inserted: 0 };
  }
  flushing = true;
  let inserted = 0;
  try {
    const db = database.getDb();
    if (!db) {
      // DB not ready — leave the buffer for the next tick (bounded by MAX_BUFFER).
      return { inserted: 0 };
    }
    const collection = db.collection('perfMetrics');
    // Drain in batches so a long backlog doesn't build one giant insert.
    while (buffer.length > 0) {
      const batch = buffer.splice(0, MAX_BATCH);
      try {
        await collection.insertMany(batch, { ordered: false });
        inserted += batch.length;
      } catch (err) {
        // Drop this batch rather than re-buffering — re-buffering a failing
        // batch would loop forever and grow memory. Count it and move on.
        dropped += batch.length;
        logger.debug('perfMetricsBuffer batch insert failed', { error: err.message, size: batch.length });
      }
    }
    if (dropped > 0) {
      logger.warn('perfMetricsBuffer dropped metrics', { dropped });
      dropped = 0;
    }
  } finally {
    flushing = false;
  }
  return { inserted };
}

export function startPerfMetricsFlusher() {
  if (interval) {
    logger.warn('perfMetricsBuffer already started — ignoring duplicate start');
    return;
  }
  interval = setInterval(() => {
    flush().catch((err) =>
      logger.error('perfMetricsBuffer flush threw', { error: err.message })
    );
  }, FLUSH_INTERVAL_MS);
  // Don't let this timer keep the event loop alive on its own.
  if (typeof interval.unref === 'function') interval.unref();
  logger.info('perfMetricsBuffer flusher started', { flushIntervalMs: FLUSH_INTERVAL_MS });
}

export async function stopPerfMetricsFlusher() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  // Final drain so the last partial batch isn't lost on shutdown.
  await flush().catch((err) =>
    logger.error('perfMetricsBuffer final flush threw', { error: err.message })
  );
}

// Exported for tests.
export const _state = () => ({ size: buffer.length, flushing, dropped });
export const _reset = () => { buffer = []; flushing = false; dropped = 0; };
