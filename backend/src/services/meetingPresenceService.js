import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { extractMeetingThreadId, escapeRegExp } from '../utils/teamsMeeting.js';

const DETECTOR_SCOPE = 'meeting-presence';
const DETECTOR_TOKEN_EXPIRY = process.env.MEETING_DETECTOR_TOKEN_EXPIRY || '90d';

class MeetingPresenceService {
  // Mint the long-lived, narrowly-scoped token the extension carries. Signed
  // with the same secret as access tokens but the `scope` claim makes it
  // usable ONLY on the meeting-presence report endpoint (authenticateHTTP
  // rejects any token with a scope claim).
  issueDetectorToken(email) {
    return jwt.sign({ email, scope: DETECTOR_SCOPE }, config.auth.jwtSecret, {
      expiresIn: DETECTOR_TOKEN_EXPIRY,
    });
  }

  // Record a presence report from the extension. Only `in_call` flips the
  // meetingStarted flag; lobby / pre-join are accepted and logged but never
  // flip it. Returns a small result describing what happened.
  async recordPresence({ email, meetingUrl, state }) {
    const threadId = extractMeetingThreadId(meetingUrl);
    if (!threadId) {
      logger.debug('Meeting presence: no thread id in reported url', { email, state });
      return { matched: false, reason: 'no_meeting_id' };
    }

    const col = database.getCollection('taskBody');
    const rx = { $regex: escapeRegExp(threadId), $options: 'i' };
    const linkMatch = {
      $or: [
        { meetingLink: rx },
        { joinUrl: rx },
        { joinWebUrl: rx },
      ],
    };
    // ALL tasks tied to this meeting — a reschedule or duplicated row can
    // share the thread id, and a findOne would pick one arbitrarily (and
    // short-circuit on an already-started older row, stranding the rest).
    const tasks = await col
      .find(linkMatch, { projection: { _id: 1, meetingStarted: 1 } })
      .limit(20)
      .toArray();

    if (tasks.length === 0) {
      logger.debug('Meeting presence: no task for meeting id', { email, threadId, state });
      return { matched: false, reason: 'no_task' };
    }

    const taskIds = tasks.map((t) => String(t._id));
    const taskId = taskIds[0];

    if (state !== 'in_call') {
      // lobby / pre-join — surfaced for observability, no flag change
      return { matched: true, taskId, taskIds, flagged: false, state };
    }

    // Flip EVERY task of this meeting that is not started yet — conditional,
    // so it stays idempotent under concurrent reports. The taskBody change
    // stream broadcasts `taskUpdated` per modified row, so the live "Started"
    // badges appear without any explicit emit here.
    const res = await col.updateMany(
      { ...linkMatch, meetingStarted: { $ne: true } },
      {
        $set: {
          meetingStarted: true,
          meetingStartedAt: new Date().toISOString(),
          meetingStartedBy: email,
          meetingStartedSource: 'extension',
        },
      }
    );

    if (res.modifiedCount === 0) {
      return { matched: true, taskId, taskIds, flagged: false, alreadyStarted: true };
    }

    logger.info('Meeting presence: meeting marked started from extension', {
      taskIds,
      email,
      threadId,
      modified: res.modifiedCount,
    });

    return { matched: true, taskId, taskIds, flagged: true, flaggedCount: res.modifiedCount };
  }
}

export const meetingPresenceService = new MeetingPresenceService();
