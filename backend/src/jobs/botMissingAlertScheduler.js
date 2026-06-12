// Recorder-missing alert (2026-06-12 plan, Layer 1).
//
// Two clocks matter: experts join ~30 minutes EARLY to prepare (that is
// when the Meeting Detector flips `meetingStarted`), but recording is
// anchored to the SCHEDULED interview start (`interviewStartAt`). This
// sweep fires when the interview clock says the recording should be
// running and the bot is not in:
//
//   now >= interviewStartAt + 5 min   (grace past the scheduled start)
//   now <  interviewEndsAt            (still inside the scheduled slot)
//   meetingStarted === true           (people are actually in the call —
//                                      the prep-clock signal gates against
//                                      alerting on no-shows)
//   bot not joined                    (no botJoinedAt, status not joined)
//
// Each matching task notifies the assigned expert AND co-experts once
// (popup, so it is seen mid-meeting) with a pointer to the task's
// "Re-invite recorder" button — one click re-pushes Fred via the
// Fireflies addToLiveMeeting mutation (POST /tasks/:id/invite-bot).
// `botMissingAlertedAt` dedupes; alerts never repeat for a task.
//
// Default ON; set BOT_MISSING_ALERTS_DISABLED=1 to opt out.

import { database } from '../config/database.js';
import { notificationService } from '../services/notificationService.js';
import { logger } from '../utils/logger.js';

const TICK_MS = 2 * 60 * 1000;
const START_GRACE_MS = 5 * 60 * 1000;
const LOOKBACK_MS = 12 * 60 * 60 * 1000; // never alert on stale history

let interval = null;
let running = false;

export async function sweepBotMissingOnce() {
  const col = database.getCollection('taskBody');
  if (!col) return 0;

  const now = Date.now();
  const tasks = await col
    .find(
      {
        meetingStarted: true,
        interviewStartAt: {
          $lte: new Date(now - START_GRACE_MS),
          $gte: new Date(now - LOOKBACK_MS),
        },
        interviewEndsAt: { $gt: new Date(now) },
        botStatus: { $nin: ['main_joined', 'completed'] },
        $or: [{ botJoinedAt: null }, { botJoinedAt: { $exists: false } }],
        botMissingAlertedAt: { $exists: false },
        taskType: { $ne: 'mock' },
      },
      {
        projection: {
          subject: 1, assignedTo: 1, assignedExpert: 1, coAssignees: 1,
          'Start Time Of Interview': 1,
        },
      }
    )
    .limit(20)
    .toArray();

  let alerted = 0;
  for (const task of tasks) {
    const recipients = [
      (task.assignedTo || task.assignedExpert || '').toLowerCase(),
      ...(Array.isArray(task.coAssignees) ? task.coAssignees : []),
    ].filter(Boolean);
    if (recipients.length === 0) continue;

    // Mark first — a notification fan-out crash must not re-alert forever.
    await col.updateOne(
      { _id: task._id, botMissingAlertedAt: { $exists: false } },
      { $set: { botMissingAlertedAt: new Date() } }
    );

    await Promise.all(
      recipients.map((email) =>
        notificationService.createNotification(email, {
          type: 'warning',
          title: 'Recorder missing from your interview',
          description:
            `It's past the scheduled start (${task['Start Time Of Interview'] || ''} EST) and the Fireflies recorder hasn't joined: ` +
            `${task.subject || 'your interview'}. Open the task and click "Re-invite recorder" to send it back in.`,
          link: '/tasks',
          popup: true,
        }).catch((err) =>
          logger.warn('botMissingAlert: notification failed', { email, error: err.message })
        )
      )
    );
    alerted += 1;
    logger.info('botMissingAlert: expert notified', {
      taskId: String(task._id), recipients, subject: task.subject,
    });
  }
  return alerted;
}

export function startBotMissingAlertScheduler() {
  if (process.env.BOT_MISSING_ALERTS_DISABLED === '1') {
    logger.info('botMissingAlertScheduler disabled via env');
    return;
  }
  if (interval) return;
  interval = setInterval(async () => {
    if (running) return; // skip ticks while a sweep is in flight
    running = true;
    try {
      await sweepBotMissingOnce();
    } catch (err) {
      logger.warn('botMissingAlert sweep failed', { error: err.message });
    } finally {
      running = false;
    }
  }, TICK_MS);
  if (interval.unref) interval.unref();
  logger.info('botMissingAlertScheduler started', { tickMs: TICK_MS });
}

export function stopBotMissingAlertScheduler() {
  if (interval) clearInterval(interval);
  interval = null;
}
