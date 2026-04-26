import moment from 'moment-timezone';
import { firefliesService } from '../services/firefliesService.js';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const TICK_INTERVAL_MS = 60_000;
const TIMEZONE = 'America/New_York';

// interviewDateTime is stored as 'YYYY-MM-DDTHH:mm' in EST (America/New_York)
function getMinutesUntil(task) {
  const raw = task.interviewDateTime;
  if (!raw) return null;
  const meetingMoment = moment.tz(raw, 'YYYY-MM-DDTHH:mm', TIMEZONE);
  if (!meetingMoment.isValid()) return null;
  return (meetingMoment.valueOf() - Date.now()) / 60_000;
}

async function processTask(collection, task) {
  const minutesUntil = getMinutesUntil(task);
  if (minutesUntil === null) return;

  const { _id, meetingLink, meetingPassword, botStatus = 'pending', botInviteAttempts = 0 } = task;
  const candidateName = task['Candidate Name'] || 'Candidate';
  const now = new Date();

  // Stage A — Precheck invite (T-20 to T-5)
  if (botStatus === 'pending' && minutesUntil <= 20 && minutesUntil > 5) {
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
    } catch (err) {
      await collection.updateOne(
        { _id },
        { $set: { botStatus: 'precheck_failed', botLastError: err.message } }
      );
      logger.error('Fireflies precheck invite failed', { taskId: _id, error: err.message });
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
      }
    } catch (err) {
      logger.error('Fireflies precheck verify failed', { taskId: _id, error: err.message });
    }
    return;
  }

  // Stage C — Main bot invite (T+0 to T+5)
  if (
    minutesUntil <= 0 &&
    minutesUntil > -5 &&
    ['pending', 'precheck_joined', 'precheck_failed'].includes(botStatus)
  ) {
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
    } catch (err) {
      await collection.updateOne(
        { _id },
        { $set: { botStatus: 'main_failed', botLastError: err.message } }
      );
      logger.error('Fireflies main bot invite failed', { taskId: _id, error: err.message });
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
      } else if (botInviteAttempts < 3) {
        // Retry
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
      }
    } catch (err) {
      logger.error('Fireflies main bot verify failed', { taskId: _id, error: err.message });
    }
    return;
  }
}

async function tick() {
  if (!firefliesService.enabled) return;

  try {
    const collection = database.getDb().collection('taskBody');

    // interviewDateTime is a string 'YYYY-MM-DDTHH:mm' in EST.
    // Build string bounds for the range (EST, same format).
    const cutoffStart = moment().tz(TIMEZONE).subtract(10, 'minutes').format('YYYY-MM-DDTHH:mm');
    const cutoffEnd = moment().tz(TIMEZONE).add(25, 'minutes').format('YYYY-MM-DDTHH:mm');

    const candidates = await collection
      .find({
        meetingLink: { $exists: true, $ne: null, $ne: '' },
        botStatus: { $nin: ['main_joined', 'main_failed', 'completed'] },
        interviewDateTime: { $gte: cutoffStart, $lte: cutoffEnd },
      })
      .sort({ interviewDateTime: 1 })
      .limit(100)
      .toArray();

    for (const task of candidates) {
      try {
        await processTask(collection, task);
      } catch (err) {
        logger.error('Fireflies scheduler: task failed', { taskId: task._id, error: err.message });
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
