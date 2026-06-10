/**
 * Event-loop monitor.
 *
 * The backend is a single Node process = one event-loop thread. Under load,
 * requests serialize behind each other and CPU-heavy work (BSON decode +
 * JSON.stringify, dashboard aggregations, change-stream emits) stalls the loop —
 * the "head-of-line blocking" that makes the frontend feel slow even when Mongo
 * is fast. None of the existing perf instrumentation measured the loop itself.
 *
 * This samples the two signals that *prove* loop stalls and writes them through
 * the existing batched perf buffer (so the monitor never blocks the loop it
 * measures):
 *   - event-loop DELAY (perf_hooks histogram): mean / p50 / p99 / max in ms.
 *   - event-loop UTILIZATION (0..1): how saturated the single thread is.
 * Plus the concurrency gauge (in-flight requests) and heap/rss, so a lag spike
 * can be correlated with load. Latest + a short in-memory ring are exposed for
 * GET /admin/performance; every sample is also persisted to `perfMetrics`
 * (type: 'eventLoop') for historical analysis.
 */

import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { recordPerfMetric } from './perfMetricsBuffer.js';
import { logger } from '../utils/logger.js';

const SAMPLE_INTERVAL_MS = Number.parseInt(process.env.EVENT_LOOP_SAMPLE_MS || '10000', 10);
const RING_SIZE = 90; // ~15 min of history at 10s sampling
const LAG_WARN_P99_MS = Number.parseInt(process.env.EVENT_LOOP_WARN_P99_MS || '200', 10);

let histogram = null;
let lastElu = null;
let timer = null;
let activeRequestsFn = () => 0;

const ring = [];
let latest = null;

const ns2ms = (ns) => Math.round((Number(ns) / 1e6) * 100) / 100;

function sample() {
  try {
    const h = histogram;
    const eluDelta = performance.eventLoopUtilization(lastElu);
    lastElu = performance.eventLoopUtilization();
    const mem = process.memoryUsage();

    const snapshot = {
      type: 'eventLoop',
      createdAt: new Date(),
      loopLagMeanMs: ns2ms(h.mean),
      loopLagP50Ms: ns2ms(h.percentile(50)),
      loopLagP99Ms: ns2ms(h.percentile(99)),
      loopLagMaxMs: ns2ms(h.max),
      eluUtilization: Math.round(eluDelta.utilization * 1000) / 1000,
      activeRequests: activeRequestsFn() || 0,
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      rssMb: Math.round(mem.rss / 1048576),
    };
    h.reset();

    latest = snapshot;
    ring.push(snapshot);
    if (ring.length > RING_SIZE) ring.shift();

    recordPerfMetric(snapshot); // batched, non-blocking

    if (snapshot.loopLagP99Ms > LAG_WARN_P99_MS) {
      logger.warn('Event-loop lag high', {
        p99Ms: snapshot.loopLagP99Ms,
        maxMs: snapshot.loopLagMaxMs,
        elu: snapshot.eluUtilization,
        activeRequests: snapshot.activeRequests,
      });
    }
  } catch (err) {
    logger.error('eventLoopMonitor sample failed', { error: err?.message || String(err) });
  }
}

/**
 * Start sampling. `activeRequestsFn` returns the current in-flight request
 * count (wired to app.locals.activeRequests, maintained by performanceMiddleware).
 */
export function startEventLoopMonitor({ activeRequestsFn: fn } = {}) {
  if (timer) return; // idempotent
  if (typeof fn === 'function') activeRequestsFn = fn;

  histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  lastElu = performance.eventLoopUtilization();

  timer = setInterval(sample, SAMPLE_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref(); // never keep the process alive
  logger.info('eventLoopMonitor started', { sampleIntervalMs: SAMPLE_INTERVAL_MS });
}

export function stopEventLoopMonitor() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (histogram) {
    histogram.disable();
    histogram = null;
  }
}

/** Latest snapshot + recent in-memory ring, for GET /admin/performance. */
export function getEventLoopSnapshot() {
  return { latest, recent: ring.slice(-RING_SIZE) };
}

// Test hook: force a sample synchronously (only valid while started).
export function _sampleNow() {
  if (histogram) sample();
  return latest;
}
