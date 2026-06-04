// One-shot remediation: experts who marked meetings "started" >60 min before
// the scheduled time (an SOP breach) see this on their next `maxShows` loads,
// then it disappears. Armed per-offender by
// backend/scripts/remediate-premature-meeting-starts.mongo.js — the presence of
// a `meetingStartWarning` subdoc on the user IS the trigger (no version needed).
export const MEETING_START_WARNING = {
  title: 'Meeting marked started too early',
  maxShows: 3,
  body: [
    'You marked one or more meetings as "Started" well before their scheduled time.',
    'Marking a meeting started before it begins misfeeds the information and is treated as a breach of SOP.',
    'Only toggle "Meeting Started" within 60 minutes of the scheduled start, once the meeting is actually beginning.',
    'We have cleared these incorrect marks from the record.',
  ],
};
