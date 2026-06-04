/*
 * One-shot remediation for meetings marked "Started" prematurely.
 *
 * A meeting may only be marked started within 60 min of its scheduled
 * interviewStartAt (enforced going forward by the markMeetingStarted guard).
 * Meetings marked earlier are SOP breaches. This script:
 *   1. Finds premature marks (>60 min before interviewStartAt).
 *   2. Clears the mark (meetingStarted / -At / -By) and writes an audit row
 *      to `meetingStartRemediations`.
 *   3. Arms the per-offender expert warning by seeding `users.meetingStartWarning`
 *      (the change stream propagates this to the running server's cache, so the
 *      pop-up appears live — no restart needed).
 *   4. Sends each offending expert's team lead ONE in-app notification
 *      (idempotent on eventId; 90-day expiry so it survives the 7-day TTL).
 *
 * SAFETY: dry-run by default. To apply, run with REMEDIATE_APPLY=1:
 *   mongosh "$URI/interviewSupport" backend/scripts/remediate-premature-meeting-starts.mongo.js                 # dry-run
 *   REMEDIATE_APPLY=1 mongosh "$URI/interviewSupport" backend/scripts/remediate-premature-meeting-starts.mongo.js   # apply
 *
 * IMPORTANT: run only AFTER the markMeetingStarted 60-min guard is deployed,
 * so a just-cleared future meeting cannot be immediately re-marked.
 */
/* global db */
const WINDOW_MS = 60 * 60 * 1000;
const FLAGGED_BY = 'Harsh Patel';
const APPLY = (typeof process !== 'undefined' && process.env && process.env.REMEDIATE_APPLY === '1');
const DRY_RUN = !APPLY;
const NOW = new Date();
const EXPIRES = new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// interviewStartAt is stored as UTC == Eastern wall-clock, so format the UTC parts.
function fmtEst(d) {
  const dt = new Date(d);
  let h = dt.getUTCHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  const mm = String(dt.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}, ${dt.getUTCFullYear()} ${h}:${mm} ${ampm} EST`;
}
function deriveName(email) {
  const local = String(email || '').split('@')[0] || '';
  return local.split(/[._]/).filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}
function norm(s) { return (s == null ? '' : s).toString().trim().toLowerCase().replace(/\s+/g, ' '); }
// Resolve a teamLead display-name (or email) to an email, mirroring
// candidateService._findEmailByName (displayName / name / derived-from-email).
function resolveEmailByName(name) {
  if (!name) return '';
  if (name.includes('@')) return name.trim().toLowerCase();
  const target = norm(name);
  const users = db.users.find({}, { email: 1, displayName: 1, name: 1 }).toArray();
  const found = users.find((u) => norm(u.displayName) === target || norm(u.name) === target || norm(deriveName(u.email)) === target);
  return found ? found.email.toLowerCase() : '';
}

print(`=== premature-meeting-start remediation (${DRY_RUN ? 'DRY-RUN' : 'APPLY'}) ===`);

const marked = db.taskBody.find(
  { meetingStarted: true, interviewStartAt: { $exists: true, $ne: null }, meetingStartedAt: { $exists: true, $ne: null } },
  { meetingStartedAt: 1, meetingStartedBy: 1, interviewStartAt: 1, 'Candidate Name': 1 }
).toArray();
const premature = marked.filter((t) => (new Date(t.interviewStartAt).getTime() - new Date(t.meetingStartedAt).getTime()) > WINDOW_MS);
print(`Found ${premature.length} premature mark(s) out of ${marked.length} marked-with-schedule.`);

// Group by offender.
const byOffender = {};
premature.forEach((t) => {
  const e = norm(t.meetingStartedBy);
  if (!e) return;
  (byOffender[e] = byOffender[e] || []).push(t);
});

// 1 + 2: clear the marks and write audit rows.
let cleared = 0;
premature.forEach((t) => {
  const audit = {
    taskId: t._id,
    candidate: t['Candidate Name'] || null,
    scheduledAt: t.interviewStartAt,
    scheduledEst: fmtEst(t.interviewStartAt),
    markedAt: t.meetingStartedAt,
    markedBy: norm(t.meetingStartedBy),
    clearedAt: NOW,
    clearedBy: FLAGGED_BY,
    reason: 'premature (>60 min before scheduled start)',
  };
  print(`  - clear: ${audit.candidate} | by ${audit.markedBy} | sched ${audit.scheduledEst} | marked ${new Date(t.meetingStartedAt).toISOString()}`);
  if (DRY_RUN) return;
  db.taskBody.updateOne({ _id: t._id }, { $unset: { meetingStarted: '', meetingStartedAt: '', meetingStartedBy: '' } });
  db.meetingStartRemediations.insertOne(audit);
  cleared += 1;
});

// 3 + 4: per offender — arm the expert warning + notify the team lead.
Object.keys(byOffender).forEach((email) => {
  const tasks = byOffender[email];
  const meetings = tasks.map((t) => ({ candidate: t['Candidate Name'] || 'Candidate', scheduledEst: fmtEst(t.interviewStartAt) }));
  const offenderUser = db.users.findOne({ email }, { teamLead: 1, displayName: 1, name: 1 });
  const offenderName = (offenderUser && (offenderUser.displayName || offenderUser.name)) || deriveName(email);
  const tlName = offenderUser && offenderUser.teamLead ? offenderUser.teamLead.toString().trim() : '';
  const tlEmail = resolveEmailByName(tlName);
  print(`  * offender ${email} (${offenderName}): ${tasks.length} mark(s); teamLead "${tlName}" -> ${tlEmail || '(UNRESOLVED)'}`);

  if (!DRY_RUN) {
    db.users.updateOne(
      { email },
      { $set: { meetingStartWarning: { shownCount: 0, dismissed: false, reason: 'premature', meetings, clearedAt: NOW, by: FLAGGED_BY } } }
    );
  }

  const list = meetings.map((m) => `${m.candidate} (scheduled ${m.scheduledEst})`).join('; ');
  const description = `Flagged by ${FLAGGED_BY}. ${offenderName} (${email}) marked the following meeting(s) as "Started" well before their scheduled time: ${list}. Marking a meeting started before it begins misfeeds the information and is a breach of SOP. As their team lead it is your duty to verify what your team feeds into the system. We are clearing these marks from the record now.`;
  const eventId = `premature-meeting-start:${email}`;
  if (!tlEmail) { print('    !! team lead email unresolved — notification skipped'); return; }
  print(`    -> notify ${tlEmail} (eventId ${eventId})`);
  if (DRY_RUN) return;
  db.notifications.updateOne(
    { recipient: tlEmail, eventId },
    {
      $setOnInsert: {
        recipient: tlEmail,
        eventId,
        type: 'sop.meeting_start_warning',
        title: 'SOP breach: meeting marked started early',
        description,
        actor: FLAGGED_BY,
        link: null,
        candidateId: null,
        isRead: false,
        createdAt: NOW,
        expiresAt: EXPIRES,
      },
    },
    { upsert: true }
  );
});

print(DRY_RUN ? '=== DRY-RUN complete (no writes). Re-run with REMEDIATE_APPLY=1 to apply. ===' : `=== APPLIED: cleared ${cleared} mark(s), armed ${Object.keys(byOffender).length} offender(s). ===`);
