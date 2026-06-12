// Transcript reliability, Layer 3 (2026-06-12 plan).
//
// Two ticks in one scheduler:
//
//  1. DISCOVERY (every 15 min) — tasks whose SCHEDULED end passed ≥20
//     minutes ago (Fireflies processing buffer) and whose transcription
//     flag is still unset get swept through the existing background
//     discovery (taskModel.queueTranscriptDiscovery → Appwrite check →
//     persisted flag → taskUpdated broadcast). Until now discovery only
//     ran when somebody loaded the Tasks page; this makes flags flip on
//     a quiet dashboard too.
//
//  2. DAILY GAPS DIGEST (once per day after 6:15 PM Eastern) — the
//     end-of-day audit that was run by hand on 2026-06-12: every task
//     past its scheduled end, marked Completed, with no transcript.
//     Admins and technical leads get a notification naming the gaps so
//     silently-missing recordings get human eyes the same day.
//     (Recording-window sanity — comparing the transcript's actual start
//     against interviewStartAt — needs a Fireflies transcripts query
//     from the backend; deferred.)
//
// Default ON; TRANSCRIPT_GAPS_DISABLED=1 opts out.

import moment from 'moment-timezone';
import { database } from '../config/database.js';
import { taskModel } from '../models/Task.js';
import { notificationService } from '../services/notificationService.js';
import { logger } from '../utils/logger.js';

const TICK_MS = 15 * 60 * 1000;
const PROCESSING_BUFFER_MS = 20 * 60 * 1000;
const TZ = 'America/New_York';
const DIGEST_AFTER_HOUR_ET = 18; // 6 PM Eastern
const DIGEST_AFTER_MIN_ET = 15;
const STATE_KEY = 'transcript_gaps_digest';

let interval = null;
let running = false;

const dayWindowUtc = () => {
  const start = moment.tz(TZ).startOf('day');
  return { start: start.toDate(), end: start.clone().endOf('day').toDate() };
};

export async function sweepDiscoveryOnce() {
  const col = database.getCollection('taskBody');
  if (!col) return 0;
  const { start } = dayWindowUtc();
  const cutoff = new Date(Date.now() - PROCESSING_BUFFER_MS);
  const tasks = await col
    .find(
      {
        interviewEndsAt: { $gte: start, $lt: cutoff },
        transcription: { $ne: true },
        taskType: { $ne: 'mock' },
      },
      { projection: { subject: 1, Subject: 1, transcription: 1 } }
    )
    .limit(150)
    .toArray();
  if (tasks.length === 0) return 0;
  taskModel.queueTranscriptDiscovery(tasks);
  logger.info('transcriptGaps: discovery queued', { candidates: tasks.length });
  return tasks.length;
}

const alreadySentToday = async () => {
  try {
    const col = database.getCollection('systemState');
    if (!col) return false;
    const doc = await col.findOne({ _id: STATE_KEY });
    if (!doc?.lastSentAt) return false;
    return moment.tz(doc.lastSentAt, TZ).isSame(moment.tz(TZ), 'day');
  } catch {
    return false;
  }
};

const stampSent = async () => {
  try {
    const col = database.getCollection('systemState');
    if (col) {
      await col.updateOne(
        { _id: STATE_KEY },
        { $set: { lastSentAt: new Date() } },
        { upsert: true }
      );
    }
  } catch (err) {
    logger.warn('transcriptGaps: stamp failed', { error: err.message });
  }
};

export async function sendDailyDigestOnce() {
  const nowEt = moment.tz(TZ);
  if (
    nowEt.hour() < DIGEST_AFTER_HOUR_ET ||
    (nowEt.hour() === DIGEST_AFTER_HOUR_ET && nowEt.minute() < DIGEST_AFTER_MIN_ET)
  ) {
    return null; // not digest time yet
  }
  if (await alreadySentToday()) return null;

  const col = database.getCollection('taskBody');
  const usersCol = database.getCollection('users');
  if (!col || !usersCol) return null;

  const { start } = dayWindowUtc();
  const gaps = await col
    .find(
      {
        interviewEndsAt: { $gte: start, $lt: new Date() },
        status: /completed/i,
        transcription: { $ne: true },
        taskType: { $ne: 'mock' },
      },
      { projection: { subject: 1 } }
    )
    .sort({ interviewEndsAt: 1 })
    .limit(60)
    .toArray();

  // Stamp BEFORE fan-out so a notification failure can't double-send.
  await stampSent();
  if (gaps.length === 0) {
    logger.info('transcriptGaps: digest day clean — no gaps, no notification');
    return 0;
  }

  const recipients = await usersCol
    .find(
      {
        active: { $ne: false },
        $or: [
          { role: 'admin' },
          { role: { $in: ['lead', 'teamLead'] }, team: 'technical' },
          { role: 'lead' },
        ],
      },
      { projection: { email: 1 } }
    )
    .toArray();

  const names = gaps
    .slice(0, 8)
    .map((g) => (g.subject || '').replace('Interview Support - ', ''))
    .join(' • ');
  const more = gaps.length > 8 ? ` …and ${gaps.length - 8} more` : '';

  await Promise.all(
    recipients.map((u) =>
      notificationService.createNotification((u.email || '').toLowerCase(), {
        type: 'warning',
        title: `Transcript gaps today: ${gaps.length} interview${gaps.length === 1 ? '' : 's'} without a recording`,
        description: `Completed today but no transcript found: ${names}${more}. If a recording exists in Fireflies it will arrive via the reconciler; otherwise the meeting was never recorded — please check with the expert.`,
        link: '/tasks',
      }).catch((err) =>
        logger.warn('transcriptGaps: digest notification failed', { email: u.email, error: err.message })
      )
    )
  );
  logger.info('transcriptGaps: digest sent', { gaps: gaps.length, recipients: recipients.length });
  return gaps.length;
}

export function startTranscriptGapsScheduler() {
  if (process.env.TRANSCRIPT_GAPS_DISABLED === '1') {
    logger.info('transcriptGapsScheduler disabled via env');
    return;
  }
  if (interval) return;
  interval = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await sweepDiscoveryOnce();
      await sendDailyDigestOnce();
    } catch (err) {
      logger.warn('transcriptGaps tick failed', { error: err.message });
    } finally {
      running = false;
    }
  }, TICK_MS);
  if (interval.unref) interval.unref();
  logger.info('transcriptGapsScheduler started', { tickMs: TICK_MS });
}

export function stopTranscriptGapsScheduler() {
  if (interval) clearInterval(interval);
  interval = null;
}
