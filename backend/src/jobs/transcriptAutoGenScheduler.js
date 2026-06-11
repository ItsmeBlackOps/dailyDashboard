// Auto-generates the Interview Debrief as soon as a task's transcript is
// detected — no user click required. Keyed off the `transcription: true` flag
// that enrichWithTranscriptStatus now persists on taskBody documents (the
// flag flip IS the "transcript arrived" event).
//
// Guarantees:
//  - FUTURE transcripts only: a baseline marker stamped on first run means
//    tasks flagged before this feature shipped are never mass-generated.
//  - Idempotent: each task is claimed atomically via `autoDebrief` and the
//    debrief service's own cache makes regeneration a no-op.
//  - Single owner: a schedulerLocks lease spanning the tick interval keeps
//    the blue/green colors from double-processing (claims are atomic anyway).
//  - Bounded cost: BATCH_PER_TICK tasks per tick, generation serialized by
//    interviewDebriefService's single in-process worker, one retry max.
//
// Kill switch: TRANSCRIPT_AUTOGEN_ENABLED=false.
import os from 'os';
import { logger } from '../utils/logger.js';
import { database } from '../config/database.js';
import { interviewDebriefService } from '../services/interviewDebriefService.js';
import { acquireTickLease } from './tickLease.js';

const TICK_MS = parseInt(process.env.TRANSCRIPT_AUTOGEN_TICK_MS || '600000', 10); // 10 min
const BATCH_PER_TICK = parseInt(process.env.TRANSCRIPT_AUTOGEN_BATCH || '5', 10);
const LOOKBACK_DAYS = parseInt(process.env.TRANSCRIPT_AUTOGEN_LOOKBACK_DAYS || '14', 10);
// Self-heal: a generation that fails (e.g. "Transcript not found" because the
// transcript arrives late, or matching wasn't yet able to find a rescheduled
// title) is retried up to MAX_ATTEMPTS with a backoff, then left terminal so
// genuinely transcript-less tasks don't loop forever.
const MAX_ATTEMPTS = parseInt(process.env.TRANSCRIPT_AUTOGEN_MAX_ATTEMPTS || '4', 10);
const RECOVERY_BACKOFF_MS = parseInt(process.env.TRANSCRIPT_AUTOGEN_RETRY_BACKOFF_MS || String(30 * 60_000), 10);
const REQUESTED_BY = 'transcript-autogen';
const LEASE_ID = 'transcriptAutoGenScheduler';
const BASELINE_ID = 'transcriptAutoGenBaseline';
const OWNER = `${os.hostname()}:${process.pid}`;

let interval = null;

// First run stamps every already-flagged task as 'baseline' (no generation)
// and records the baseline instant; only transcripts DETECTED after that
// instant auto-generate. Returns the baseline Date.
async function ensureBaseline(db) {
  const locks = db.collection('schedulerLocks');
  const existing = await locks.findOne({ _id: BASELINE_ID });
  if (existing?.at) {
    return new Date(existing.at);
  }

  const at = new Date();
  const res = await db.collection('taskBody').updateMany(
    { transcription: true, autoDebrief: { $exists: false } },
    { $set: { autoDebrief: { status: 'baseline', at } } }
  );
  try {
    await locks.insertOne({ _id: BASELINE_ID, at });
  } catch (err) {
    if (err?.code === 11000) {
      // the other color raced us — use its baseline
      const raced = await locks.findOne({ _id: BASELINE_ID });
      if (raced?.at) return new Date(raced.at);
    }
    throw err;
  }
  logger.info('Transcript auto-gen baseline established', {
    baselinedTasks: res.modifiedCount,
    at: at.toISOString(),
  });
  return at;
}

// Move previously queued tasks forward: cache present -> generated;
// job failed (or state lost to a restart) -> one retry, then failed.
async function sweepQueued(col) {
  const queued = await col
    .find({ 'autoDebrief.status': 'queued' }, { projection: { _id: 1, autoDebrief: 1 } })
    .limit(20)
    .toArray();

  for (const task of queued) {
    const id = String(task._id);
    try {
      const cached = await interviewDebriefService.getCachedContent(id);
      if (cached?.content) {
        await col.updateOne(
          { _id: task._id },
          { $set: { autoDebrief: { status: 'generated', at: new Date(), requestedBy: REQUESTED_BY } } }
        );
        logger.info('Transcript auto-gen: debrief ready', { taskId: id });
        continue;
      }

      const state = interviewDebriefService.getJobState(id);
      const queuedAt = task.autoDebrief?.at ? new Date(task.autoDebrief.at).getTime() : 0;
      const stale = !state && Date.now() - queuedAt > 30 * 60_000; // restart lost the in-memory queue
      if (state?.status === 'failed' || stale) {
        const attempts = task.autoDebrief?.attempts || 1;
        if (attempts < MAX_ATTEMPTS) {
          const doc = await col.findOne({ _id: task._id });
          interviewDebriefService.enqueueDebriefGeneration(id, doc, REQUESTED_BY, false);
          await col.updateOne(
            { _id: task._id },
            { $set: { autoDebrief: { status: 'queued', at: new Date(), attempts: attempts + 1, requestedBy: REQUESTED_BY } } }
          );
          logger.warn('Transcript auto-gen: retrying debrief generation', { taskId: id, attempt: attempts + 1, error: state?.error || 'state lost' });
        } else {
          await col.updateOne(
            { _id: task._id },
            { $set: { autoDebrief: { status: 'failed', at: new Date(), error: state?.error || 'state lost after retries', attempts, requestedBy: REQUESTED_BY } } }
          );
          logger.error('Transcript auto-gen: debrief generation failed permanently', { taskId: id, attempts, error: state?.error || 'state lost' });
        }
      }
      // status queued/processing with live state -> leave it; next tick re-checks
    } catch (err) {
      logger.warn('Transcript auto-gen: sweep item failed (non-fatal)', { taskId: id, error: err.message });
    }
  }
}

// Re-open previously-FAILED tasks so they self-heal: a transcript that
// arrived late (or only became matchable once reschedule-tolerant matching
// shipped) gets another generation attempt. Bounded by MAX_ATTEMPTS and a
// per-task backoff so a genuinely transcript-less task settles terminal.
async function recoverFailed(col) {
  const lookbackStart = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60_000);
  const backoffCutoff = new Date(Date.now() - RECOVERY_BACKOFF_MS);
  const failed = await col
    .find({
      'autoDebrief.status': 'failed',
      'autoDebrief.at': { $lt: backoffCutoff },
      transcription: true,
      interviewStartAt: { $gte: lookbackStart },
    }, { projection: { _id: 1, autoDebrief: 1 } })
    .sort({ 'autoDebrief.at': 1 })
    .limit(BATCH_PER_TICK)
    .toArray();

  for (const task of failed) {
    const id = String(task._id);
    const attempts = task.autoDebrief?.attempts || 1;
    if (attempts >= MAX_ATTEMPTS) continue;
    try {
      const cached = await interviewDebriefService.getCachedContent(id);
      if (cached?.content) {
        await col.updateOne(
          { _id: task._id },
          { $set: { autoDebrief: { status: 'generated', at: new Date(), requestedBy: REQUESTED_BY } } }
        );
        logger.info('Transcript auto-gen: failed task already cached — marked generated', { taskId: id });
        continue;
      }
      const doc = await col.findOne({ _id: task._id });
      interviewDebriefService.enqueueDebriefGeneration(id, doc, REQUESTED_BY, false);
      await col.updateOne(
        { _id: task._id },
        { $set: { autoDebrief: { status: 'queued', at: new Date(), attempts: attempts + 1, requestedBy: REQUESTED_BY } } }
      );
      logger.warn('Transcript auto-gen: recovering previously-failed debrief', { taskId: id, attempt: attempts + 1 });
    } catch (err) {
      logger.warn('Transcript auto-gen: recovery item failed (non-fatal)', { taskId: id, error: err.message });
    }
  }
}

async function tick() {
  try {
    const db = database.getDb();
    // lease spans the tick interval so one color owns the cadence end-to-end
    if (!(await acquireTickLease(db, LEASE_ID, OWNER, TICK_MS + 60_000))) {
      logger.debug('Transcript auto-gen tick skipped — lease held by another instance');
      return;
    }

    const baselineAt = await ensureBaseline(db);
    const col = db.collection('taskBody');

    await sweepQueued(col);
    await recoverFailed(col);

    const lookbackStart = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60_000);
    const candidates = await col
      .find({
        transcription: true,
        autoDebrief: { $exists: false },
        transcriptionDetectedAt: { $gte: baselineAt },
        interviewStartAt: { $gte: lookbackStart },
      })
      .sort({ transcriptionDetectedAt: -1 })
      .limit(BATCH_PER_TICK)
      .toArray();

    for (const task of candidates) {
      const id = String(task._id);
      try {
        // atomic claim — the loser of any race sees autoDebrief already set
        const claimed = await col.findOneAndUpdate(
          { _id: task._id, autoDebrief: { $exists: false } },
          { $set: { autoDebrief: { status: 'queued', at: new Date(), attempts: 1, requestedBy: REQUESTED_BY } } }
        );
        if (!claimed || (claimed.value !== undefined && !claimed.value)) {
          continue;
        }

        const cached = await interviewDebriefService.getCachedContent(id);
        if (cached?.content) {
          await col.updateOne(
            { _id: task._id },
            { $set: { autoDebrief: { status: 'generated', at: new Date(), cached: true, requestedBy: REQUESTED_BY } } }
          );
          logger.info('Transcript auto-gen: debrief already cached', { taskId: id });
          continue;
        }

        interviewDebriefService.enqueueDebriefGeneration(id, task, REQUESTED_BY, false);
        logger.info('Transcript auto-gen: debrief generation queued', {
          taskId: id,
          candidate: task['Candidate Name'] || null,
          detectedAt: task.transcriptionDetectedAt || null,
        });
      } catch (err) {
        logger.error('Transcript auto-gen: task failed (non-fatal)', { taskId: id, error: err.message });
      }
    }
  } catch (err) {
    logger.error('Transcript auto-gen tick failed', { error: err.message });
  }
}

export function startTranscriptAutoGenScheduler() {
  if (process.env.TRANSCRIPT_AUTOGEN_ENABLED === 'false') {
    logger.warn('Transcript auto-gen scheduler disabled via TRANSCRIPT_AUTOGEN_ENABLED=false');
    return;
  }
  logger.info('Transcript auto-gen scheduler started', { tickMs: TICK_MS, batch: BATCH_PER_TICK });
  // first pass shortly after boot (lets the DB connection settle), then steady cadence
  setTimeout(() => {
    tick().catch((err) => logger.error('Transcript auto-gen first tick threw', { error: err.message }));
  }, 30_000);
  interval = setInterval(() => {
    tick().catch((err) => logger.error('Transcript auto-gen tick threw', { error: err.message }));
  }, TICK_MS);
}

export function stopTranscriptAutoGenScheduler() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}

// Test seam — run a single pass without timers.
export const _tick = tick;
