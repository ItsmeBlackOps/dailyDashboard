import moment from 'moment-timezone';
import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { graphMeetingService } from './graphMeetingService.js';

const LOCK_TTL_MS = 3 * 60 * 1000;
const EVENT_TZ_IANA = 'America/New_York';
const EVENT_TZ_WINDOWS = 'Eastern Standard Time';
const TIME_FORMATS = ['MM/DD/YYYY h:mm A', 'MM/DD/YYYY hh:mm A', 'MM/DD/YYYY HH:mm a'];

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildEventPayload(taskDoc) {
  const dateStr = taskDoc?.['Date of Interview'];
  const startStr = taskDoc?.['Start Time Of Interview'];
  const endStr = taskDoc?.['End Time Of Interview'];

  const start = moment.tz(`${dateStr} ${startStr}`, TIME_FORMATS, true, EVENT_TZ_IANA);
  const end = moment.tz(`${dateStr} ${endStr}`, TIME_FORMATS, true, EVENT_TZ_IANA);
  if (!start.isValid() || !end.isValid()) {
    logger.warn('buildEventPayload: invalid interview times', { taskId: taskDoc?._id });
    return null;
  }

  const candidate = taskDoc['Candidate Name'] || 'candidate';
  const subject = taskDoc.subject || `Interview for ${candidate}`;
  const bodyHtml = [
    '<div>',
    `<p><strong>Candidate:</strong> ${escapeHtml(taskDoc['Candidate Name'] || '')}</p>`,
    `<p><strong>Client:</strong> ${escapeHtml(taskDoc['End Client'] || '')}</p>`,
    `<p><strong>Round:</strong> ${escapeHtml(taskDoc['Interview Round'] || '')}</p>`,
    '<p>Join via the Microsoft Teams meeting button on this event.</p>',
    '</div>',
  ].join('');

  return {
    subject,
    body: { contentType: 'HTML', content: bodyHtml },
    start: { dateTime: start.format('YYYY-MM-DDTHH:mm:ss'), timeZone: EVENT_TZ_WINDOWS },
    end: { dateTime: end.format('YYYY-MM-DDTHH:mm:ss'), timeZone: EVENT_TZ_WINDOWS },
    attendees: [
      { emailAddress: { address: 'harsh.patel@silverspaceinc.com', name: 'Harsh Patel' }, type: 'required' },
      { emailAddress: { address: 'fred@fireflies.ai', name: 'Fred (Fireflies)' }, type: 'required' },
    ],
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness',
    location: { displayName: 'Microsoft Teams Meeting' },
  };
}

const TASK_COLLECTION = 'taskBody';

function hasLink(doc) {
  return Boolean(doc && (doc.meetingLink || doc.joinUrl || doc.joinWebUrl));
}

function linkOf(doc) {
  return (doc && (doc.meetingLink || doc.joinUrl || doc.joinWebUrl)) || '';
}

export async function ensureMeetingForTask({ taskId, userAssertion, actorEmail }) {
  if (!ObjectId.isValid(taskId)) {
    const err = new Error('Invalid taskId');
    err.statusCode = 400;
    throw err;
  }
  const _id = new ObjectId(taskId);
  const col = database.getCollection(TASK_COLLECTION);

  // 1. Short-circuit: a meeting already exists -> no Graph call.
  const current = await col.findOne({ _id });
  if (!current) {
    const err = new Error('Task not found');
    err.statusCode = 404;
    throw err;
  }
  if (hasLink(current)) {
    return { status: 'exists', meetingLink: linkOf(current) };
  }

  // 2. Atomic claim: only one caller transitions an unlinked, unlocked
  //    (or stale-locked) task into the locked state.
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - LOCK_TTL_MS);
  const claim = await col.findOneAndUpdate(
    {
      _id,
      $and: [
        { $or: [{ meetingLink: { $in: [null, ''] } }, { meetingLink: { $exists: false } }] },
        { $or: [{ joinUrl: { $in: [null, ''] } }, { joinUrl: { $exists: false } }] },
        { $or: [{ joinWebUrl: { $in: [null, ''] } }, { joinWebUrl: { $exists: false } }] },
        { $or: [
          { meetingCreationLockAt: { $exists: false } },
          { meetingCreationLockAt: null },
          { meetingCreationLockAt: { $lt: staleCutoff } },
        ] },
      ],
    },
    { $set: { meetingCreationLockAt: now, meetingCreationLockBy: actorEmail || null } },
    { returnDocument: 'after' }
  );

  if (!claim) {
    // Lost the claim: either a link appeared, or someone else holds a fresh lock.
    const recheck = await col.findOne({ _id });
    if (hasLink(recheck)) return { status: 'exists', meetingLink: linkOf(recheck) };
    return { status: 'pending' };
  }

  // 3. We hold the lock. Create the event via OBO; release the lock on any failure.
  try {
    const payload = buildEventPayload(claim);
    if (!payload) {
      const err = new Error('Task has invalid interview times');
      err.statusCode = 422;
      throw err;
    }
    const event = await graphMeetingService.createEventMeeting(userAssertion, payload);
    const joinUrl = event?.onlineMeeting?.joinUrl || '';
    if (!joinUrl) {
      const err = new Error('Graph did not return a join URL');
      err.statusCode = 502;
      throw err;
    }

    // 4. Lobby bypass = everyone (best-effort; failure must not lose the meeting).
    try {
      await graphMeetingService.setMeetingLobbyBypass(userAssertion, joinUrl);
    } catch (err) {
      logger.warn('ensureMeetingForTask: lobby bypass failed', { taskId, error: err.message });
    }

    // 5. Persist link + reset bot fields + release lock.
    await col.updateOne(
      { _id },
      {
        $set: {
          meetingLink: joinUrl,
          joinUrl,
          joinWebUrl: joinUrl,
          botStatus: 'pending',
          botInviteAttempts: 0,
          botJoinedAt: null,
          precheckCheckedAt: null,
          botLastError: null,
          updatedAt: new Date(),
        },
        $unset: { meetingCreationLockAt: '', meetingCreationLockBy: '' },
      }
    );

    return { status: 'created', meetingLink: joinUrl };
  } catch (error) {
    // Release the lock so a later retry can proceed.
    await col.updateOne({ _id }, { $unset: { meetingCreationLockAt: '', meetingCreationLockBy: '' } })
      .catch((e) => logger.warn('ensureMeetingForTask: failed to release lock', { taskId, error: e.message }));
    throw error;
  }
}
