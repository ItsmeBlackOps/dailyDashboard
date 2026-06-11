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
    const task = await col.findOne(
      {
        $or: [
          { meetingLink: rx },
          { joinUrl: rx },
          { joinWebUrl: rx },
        ],
      },
      { projection: { _id: 1, meetingStarted: 1, subject: 1, assignedEmail: 1 } }
    );

    if (!task) {
      logger.debug('Meeting presence: no task for meeting id', { email, threadId, state });
      return { matched: false, reason: 'no_task' };
    }

    const taskId = String(task._id);

    if (state !== 'in_call') {
      // lobby / pre-join — surfaced for observability, no flag change
      return { matched: true, taskId, flagged: false, state };
    }

    if (task.meetingStarted === true) {
      return { matched: true, taskId, flagged: false, alreadyStarted: true };
    }

    // Conditional update — idempotent under concurrent reports. The taskBody
    // change stream broadcasts `taskUpdated` to every connected dashboard, so
    // the live "Started" badge appears without any explicit emit here.
    const res = await col.updateOne(
      { _id: task._id, meetingStarted: { $ne: true } },
      {
        $set: {
          meetingStarted: true,
          meetingStartedAt: new Date().toISOString(),
          meetingStartedBy: email,
          meetingStartedSource: 'extension',
        },
      }
    );

    logger.info('Meeting presence: meeting marked started from extension', {
      taskId,
      email,
      threadId,
      modified: res.modifiedCount,
    });

    return { matched: true, taskId, flagged: res.modifiedCount > 0 };
  }
}

export const meetingPresenceService = new MeetingPresenceService();
