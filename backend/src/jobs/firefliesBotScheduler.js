import moment from 'moment-timezone';
import { firefliesService, FirefliesRateLimitError } from '../services/firefliesService.js';
import { database } from '../config/database.js';
import { TASK_EXCLUDE_HEAVY } from '../models/Task.js';

// Bug 3 followup — write per-stage audit rows so the admin Processing
// Logs / Failed Auto-Assigns tabs surface Fireflies activity. Same
// auditLog shape as Intervue + Auto-Assign external services.
const FIREFLIES_PHASE = {
  INVITE_ATTEMPT:  'FIREFLIES_INVITE_ATTEMPT',
  INVITE_SUCCESS:  'FIREFLIES_INVITE_SUCCESS',
  INVITE_FAILED:   'FIREFLIES_INVITE_FAILED',
  VERIFY_SUCCESS:  'FIREFLIES_VERIFY_SUCCESS',
  VERIFY_NOT_IN:   'FIREFLIES_VERIFY_NOT_IN_MEETING',
  VERIFY_FAILED:   'FIREFLIES_VERIFY_FAILED',
  MAIN_JOINED:     'FIREFLIES_MAIN_JOINED',
  MAIN_RETRY:      'FIREFLIES_MAIN_RETRY',
  MAIN_FAILED:     'FIREFLIES_MAIN_FAILED',
};

async function audit(phase, level, task, detail, extra = {}) {
  try {
    const auditCol = database.getCollection('auditLog');
    if (!auditCol) return;
    await auditCol.insertOne({
      subject: task?.subject || task?.Subject || `task:${task?._id}`,
      phase,
      detail: (detail || '').toString().slice(0, 500),
      level,
      timestamp: new Date(),
      extra: {
        taskId: task?._id?.toString(),
        candidateName: task?.['Candidate Name'] || null,
        meetingLink: task?.meetingLink || null,
        ...extra,
      },
    });
  } catch (e) {
    // Never let audit-write failure cascade into bot failure.
    logger.warn('Fireflies audit write failed', { error: e.message, phase });
  }
}
import { logger } from '../utils/logger.js';

const TICK_INTERVAL_MS = 60_000;
const TIMEZONE = 'America/New_York';

// NOTE: meeting links now come exclusively from the "Create meeting" flow
// (joinUrl / joinWebUrl → meetingLink). Interview emails no longer carry the
// link, so the old body-scrape fallback (extractMeetingLink +
// MEETING_LINK_PATTERNS) was removed — it had fired only twice ever and never
// in the recent window.

// interviewDateTime is stored as 'YYYY-MM-DDTHH:mm' in EST (America/New_York).
// Falls back to computing from legacy fields when the field is absent so that
// tasks ingested before the interviewDateTime backfill remain visible.
function computeInterviewDateTimeFromFields(task) {
  const dateStr = (task['Date of Interview'] || '').trim();
  const timeStr = (task['Start Time Of Interview'] || '').trim();
  const dm = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const tm = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!dm || !tm) return null;
  let hh = parseInt(tm[1], 10);
  if (tm[3].toUpperCase() === 'PM' && hh !== 12) hh += 12;
  if (tm[3].toUpperCase() === 'AM' && hh === 12) hh = 0;
  return `${dm[3]}-${dm[1].padStart(2,'0')}-${dm[2].padStart(2,'0')}T${String(hh).padStart(2,'0')}:${tm[2]}`;
}

function getMinutesUntil(task) {
  const raw = task.interviewDateTime || computeInterviewDateTimeFromFields(task);
  if (!raw) return null;
  const meetingMoment = moment.tz(raw, 'YYYY-MM-DDTHH:mm', TIMEZONE);
  if (!meetingMoment.isValid()) return null;
  return (meetingMoment.valueOf() - Date.now()) / 60_000;
}

async function processTask(collection, task) {
  const minutesUntil = getMinutesUntil(task);
  if (minutesUntil === null) return;

  let { _id, meetingLink, meetingPassword, botStatus = 'pending', botInviteAttempts = 0 } = task;
  const candidateName = task['Candidate Name'] || 'Candidate';
  const now = new Date();

  // Adopt joinUrl/joinWebUrl from the Create meeting flow when meetingLink
  // wasn't persisted (PR #41 path). Fixes tasks where Teams URL exists but
  // the scheduler/UI was looking only at meetingLink.
  if (!meetingLink && (task.joinUrl || task.joinWebUrl)) {
    meetingLink = task.joinUrl || task.joinWebUrl;
    await collection.updateOne(
      { _id },
      { $set: { meetingLink, meetingLinkAutoExtractedAt: now } }
    );
    logger.info('Fireflies scheduler: adopted Teams joinUrl as meetingLink', {
      taskId: _id,
    });
  }

  // No usable join link (and none adopted from joinUrl/joinWebUrl above) →
  // nothing the bot can do. The find() query only selects link-bearing tasks,
  // so this is a defensive guard; tick() emits a per-tick warn for in-window
  // tasks that have no link at all.
  if (!meetingLink) return;

  // Stage A — Precheck invite (T-20 to T-5)
  if (botStatus === 'pending' && minutesUntil <= 20 && minutesUntil > 5) {
    await audit(FIREFLIES_PHASE.INVITE_ATTEMPT, 'info', task,
      'Precheck invite (Stage A)', { stage: 'precheck', minutesUntil });
    try {
      await firefliesService.inviteBot({
        meetingLink,
        title: '[Precheck] ' + candidateName,
        duration: 1,
        password: meetingPassword || undefined,
      });
      await collection.updateOne(
        { _id },
        {
          $set: {
            botStatus: 'precheck_invited',
            precheckCheckedAt: null,
            botLastError: null,
          },
          $inc: { botInviteAttempts: 1 },
        }
      );
      logger.info('Fireflies precheck invited for task', { taskId: _id });
      await audit(FIREFLIES_PHASE.INVITE_SUCCESS, 'info', task,
        'Precheck invite accepted by Fireflies', { stage: 'precheck' });
    } catch (err) {
      // Rate-limit is not a per-task failure — the API said back off,
      // not "this invite is broken". Leave botStatus alone so the next
      // tick (after cooldown clears) retries naturally. Audit the
      // event so it's visible without polluting the failure counters.
      if (err instanceof FirefliesRateLimitError) {
        logger.warn('Fireflies precheck invite skipped (rate-limited)', { taskId: _id });
        await audit('FIREFLIES_RATE_LIMITED', 'warning', task, err.message, {
          stage: 'precheck',
          retryAfter: err.retryAfterEpochMs,
        });
        return;
      }
      await collection.updateOne(
        { _id },
        { $set: { botStatus: 'precheck_failed', botLastError: err.message } }
      );
      logger.error('Fireflies precheck invite failed', { taskId: _id, error: err.message });
      await audit(FIREFLIES_PHASE.INVITE_FAILED, 'error', task, err.message, {
        stage: 'precheck',
        firefliesStatus: err.status || null,
        firefliesBody: err.responseBody || err.body || null,
      });
    }
    return;
  }

  // Stage B — Verify precheck (T-18 or later, ~2 min after precheck invite)
  if (botStatus === 'precheck_invited' && minutesUntil <= 18) {
    try {
      const inMeeting = await firefliesService.isBotInMeeting(meetingLink);
      if (inMeeting) {
        await collection.updateOne(
          { _id },
          { $set: { botStatus: 'precheck_joined', precheckCheckedAt: now } }
        );
        await audit(FIREFLIES_PHASE.VERIFY_SUCCESS, 'info', task,
          'Bot present in active_meetings (precheck)', { stage: 'precheck' });
      } else {
        await collection.updateOne(
          { _id },
          {
            $set: {
              botStatus: 'precheck_failed',
              precheckCheckedAt: now,
              botLastError: 'Bot did not appear in active_meetings during precheck',
            },
          }
        );
        await audit(FIREFLIES_PHASE.VERIFY_NOT_IN, 'warning', task,
          'Bot did not appear in active_meetings during precheck', { stage: 'precheck' });
      }
    } catch (err) {
      if (err instanceof FirefliesRateLimitError) {
        logger.warn('Fireflies precheck verify skipped (rate-limited)', { taskId: _id });
        await audit('FIREFLIES_RATE_LIMITED', 'warning', task, err.message, {
          stage: 'precheck-verify',
          retryAfter: err.retryAfterEpochMs,
        });
        return;
      }
      logger.error('Fireflies precheck verify failed', { taskId: _id, error: err.message });
      await audit(FIREFLIES_PHASE.VERIFY_FAILED, 'error', task, err.message, {
        stage: 'precheck',
        firefliesStatus: err.status || null,
        firefliesBody: err.responseBody || err.body || null,
      });
    }
    return;
  }

  // Stage C — Main bot invite (T+0 to T+5)
  if (
    minutesUntil <= 0 &&
    minutesUntil > -5 &&
    ['pending', 'precheck_joined', 'precheck_failed'].includes(botStatus)
  ) {
    await audit(FIREFLIES_PHASE.INVITE_ATTEMPT, 'info', task,
      'Main bot invite (Stage C)', { stage: 'main', minutesUntil, fromStatus: botStatus });
    try {
      await firefliesService.inviteBot({
        meetingLink,
        title: candidateName,
        duration: 180,
        password: meetingPassword || undefined,
      });
      await collection.updateOne(
        { _id },
        {
          $set: { botStatus: 'main_invited', botLastError: null },
          $inc: { botInviteAttempts: 1 },
        }
      );
      logger.info('Fireflies main bot invited for task', { taskId: _id });
      await audit(FIREFLIES_PHASE.INVITE_SUCCESS, 'info', task,
        'Main bot invite accepted by Fireflies', { stage: 'main' });
    } catch (err) {
      if (err instanceof FirefliesRateLimitError) {
        logger.warn('Fireflies main bot invite skipped (rate-limited)', { taskId: _id });
        await audit('FIREFLIES_RATE_LIMITED', 'warning', task, err.message, {
          stage: 'main',
          retryAfter: err.retryAfterEpochMs,
        });
        return;
      }
      await collection.updateOne(
        { _id },
        { $set: { botStatus: 'main_failed', botLastError: err.message } }
      );
      logger.error('Fireflies main bot invite failed', { taskId: _id, error: err.message });
      await audit(FIREFLIES_PHASE.INVITE_FAILED, 'error', task, err.message, {
        stage: 'main',
        firefliesStatus: err.status || null,
        firefliesBody: err.responseBody || err.body || null,
      });
    }
    return;
  }

  // Stage D — Verify main bot (T+3 or later)
  if (botStatus === 'main_invited' && minutesUntil <= -3) {
    try {
      const inMeeting = await firefliesService.isBotInMeeting(meetingLink);
      if (inMeeting) {
        await collection.updateOne(
          { _id },
          { $set: { botStatus: 'main_joined', botJoinedAt: now } }
        );
        logger.info('Fireflies main bot confirmed joined for task', { taskId: _id });
        await audit(FIREFLIES_PHASE.MAIN_JOINED, 'info', task,
          'Bot confirmed in active_meetings', { stage: 'main', joinedAt: now });
      } else if (botInviteAttempts < 3) {
        // Retry
        await audit(FIREFLIES_PHASE.MAIN_RETRY, 'warning', task,
          'Bot not in meeting yet — retrying invite', {
            stage: 'main', attemptNumber: botInviteAttempts + 1,
          });
        await firefliesService.inviteBot({
          meetingLink,
          title: candidateName,
          duration: 180,
          password: meetingPassword || undefined,
        });
        await collection.updateOne(
          { _id },
          {
            $set: { botStatus: 'main_invited', botLastError: null },
            $inc: { botInviteAttempts: 1 },
          }
        );
        logger.info('Fireflies main bot retry invite for task', { taskId: _id, attempts: botInviteAttempts + 1 });
      } else {
        await collection.updateOne(
          { _id },
          {
            $set: {
              botStatus: 'main_failed',
              botLastError: 'Bot did not join after retries',
            },
          }
        );
        logger.warn('Fireflies main bot failed after retries', { taskId: _id });
        await audit(FIREFLIES_PHASE.MAIN_FAILED, 'error', task,
          'Bot did not join after 3 retries', {
            stage: 'main', attempts: botInviteAttempts,
          });
      }
    } catch (err) {
      if (err instanceof FirefliesRateLimitError) {
        logger.warn('Fireflies main bot verify skipped (rate-limited)', { taskId: _id });
        await audit('FIREFLIES_RATE_LIMITED', 'warning', task, err.message, {
          stage: 'main-verify',
          retryAfter: err.retryAfterEpochMs,
        });
        return;
      }
      logger.error('Fireflies main bot verify failed', { taskId: _id, error: err.message });
      await audit(FIREFLIES_PHASE.VERIFY_FAILED, 'error', task, err.message, {
        stage: 'main',
        firefliesStatus: err.status || null,
        firefliesBody: err.responseBody || err.body || null,
      });
    }
    return;
  }
}

async function tick() {
  if (!firefliesService.enabled) return;
  // If a prior request put us into rate-limit cooldown, skip the whole
  // tick. The Mongo scan + per-task work + pacing waits all yield zero
  // useful progress while we're throttled — every call would just
  // refresh the same cooldown.
  if (firefliesService.isRateLimited()) {
    logger.debug('Fireflies tick skipped — rate-limit cooldown active');
    return;
  }

  try {
    const collection = database.getDb().collection('taskBody');

    // interviewDateTime is a string 'YYYY-MM-DDTHH:mm' in EST.
    // Build string bounds for the range (EST, same format).
    const cutoffStart = moment().tz(TIMEZONE).subtract(10, 'minutes').format('YYYY-MM-DDTHH:mm');
    const cutoffEnd = moment().tz(TIMEZONE).add(25, 'minutes').format('YYYY-MM-DDTHH:mm');

    const candidates = await collection
      .find({
        $and: [
          // Must already have a usable join link (from the Create-meeting flow).
          // Link-less tasks are not botable — surfaced by the warn below.
          {
            $or: [
              { meetingLink: { $exists: true, $ne: null, $ne: '' } },
              { joinUrl:     { $exists: true, $ne: null, $ne: '' } },
              { joinWebUrl:  { $exists: true, $ne: null, $ne: '' } },
            ],
          },
          // Primary: indexed interviewDateTime range. Fallback: no interviewDateTime
          // field — getMinutesUntil() computes from legacy date/time fields and
          // processTask() naturally skips tasks outside the ±25-min window.
          {
            $or: [
              { interviewDateTime: { $gte: cutoffStart, $lte: cutoffEnd } },
              { interviewDateTime: { $exists: false } },
            ],
          },
        ],
        botStatus: { $nin: ['main_joined', 'main_failed', 'completed'] },
      }, { projection: TASK_EXCLUDE_HEAVY })
      .sort({ interviewDateTime: 1 })
      .limit(100)
      .toArray();

    // Observability: with the email body-scrape removed, a join link must come
    // from the Create-meeting flow. Surface in-window tasks that have NO link
    // at all (bot skipped) so a workflow regression is visible. Scoped to tasks
    // WITH interviewDateTime in the window (precise + cheap); non-fatal.
    try {
      const linklessInWindow = await collection.countDocuments({
        interviewDateTime: { $gte: cutoffStart, $lte: cutoffEnd },
        botStatus: { $nin: ['main_joined', 'main_failed', 'completed'] },
        $nor: [
          { meetingLink: { $exists: true, $ne: null, $ne: '' } },
          { joinUrl:     { $exists: true, $ne: null, $ne: '' } },
          { joinWebUrl:  { $exists: true, $ne: null, $ne: '' } },
        ],
      });
      if (linklessInWindow > 0) {
        logger.warn('Fireflies scheduler: in-window task(s) have no meeting link — bot skipped', {
          count: linklessInWindow,
          windowStart: cutoffStart,
          windowEnd: cutoffEnd,
        });
      }
    } catch (probeErr) {
      logger.debug('Fireflies scheduler: linkless-count probe failed (non-fatal)', { error: probeErr.message });
    }

    // Pace per-task processing to avoid bursting Fireflies. After the
    // 878d6c7 fix that finally let the scheduler reach real tasks, the
    // 2:30 PM cohort had 8 invites fire back-to-back and 5 of them hit
    // Fireflies rate-limiting. The scheduler tick window is 60 seconds
    // and the candidate scan caps at 100, so the worst case (100 tasks
    // all in window) needs to space its calls. Default 750ms gives a
    // ceiling of ~80 invites/min — under Fireflies' burst limit, well
    // within the 60s tick budget when N is small.
    //
    // Override via FIREFLIES_TICK_PACING_MS for tuning without redeploy.
    const pacingMs = parseInt(process.env.FIREFLIES_TICK_PACING_MS || '750', 10);

    for (let i = 0; i < candidates.length; i++) {
      const task = candidates[i];
      try {
        await processTask(collection, task);
      } catch (err) {
        logger.error('Fireflies scheduler: task failed', { taskId: task._id, error: err.message });
      }
      // Skip the wait after the last task — saves a needless 750ms at
      // tick end.
      if (pacingMs > 0 && i < candidates.length - 1) {
        await new Promise((r) => setTimeout(r, pacingMs));
      }
    }
  } catch (err) {
    logger.error('Fireflies scheduler tick failed', { error: err.message });
  }
}

export function startFirefliesBotScheduler() {
  if (!firefliesService.enabled) {
    logger.warn('Fireflies bot scheduler not started (service disabled)');
    return;
  }
  logger.info('Fireflies bot scheduler started (60s interval)');
  setInterval(() => {
    tick().catch((err) => logger.error('Fireflies scheduler tick threw', { error: err.message }));
  }, TICK_INTERVAL_MS);
}

// Exported for the admin /api/admin/fireflies/run-tick endpoint —
// lets ops kick a single tick on demand (e.g. after a cooldown reset
// or to confirm the scheduler is healthy without waiting 60s).
export const _tick = tick;
