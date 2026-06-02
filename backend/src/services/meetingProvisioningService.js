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
