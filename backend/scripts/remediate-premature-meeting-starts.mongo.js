/*
 * One-shot remediation for meetings marked "Started" prematurely.
 *
 * A meeting may only be marked started within 60 min of its scheduled time
 * (enforced going forward by the markMeetingStarted guard). Meetings marked
 * earlier are SOP breaches. This script:
 *   1. Finds premature marks. The schedule comes from `interviewStartAt` (a true
 *      UTC instant) when present, else it is derived from the legacy Eastern
 *      strings ("Date of Interview" + "Start Time Of Interview"). Tasks with no
 *      determinable schedule are skipped.
 *   2. Clears the mark (meetingStarted / -At / -By) and writes an audit row to
 *      `meetingStartRemediations`.
 *   3. Rebuilds, from the FULL audit trail (grouped by offender), each offender's
 *      `users.meetingStartWarning` (the change stream propagates it to the live
 *      cache → 3x pop-up) and ONE team-lead notification from Harsh Patel
 *      (90-day expiry). Rebuild = idempotent + corrects any earlier bad data.
 *
 * Times are formatted in America/New_York (handles EDT/EST). Legacy schedules
 * are interpreted as Eastern; the marks in scope are June 2026 → EDT (UTC-4).
 *
 * SAFETY: dry-run by default. Apply with REMEDIATE_APPLY=1.
 *   mongosh "$URI/interviewSupport" backend/scripts/remediate-premature-meeting-starts.mongo.js
 *   REMEDIATE_APPLY=1 mongosh "$URI/interviewSupport" backend/scripts/remediate-premature-meeting-starts.mongo.js
 *
 * Run only AFTER the markMeetingStarted guard is deployed.
 */
/* global db */
const WINDOW_MS = 60 * 60 * 1000;
const FLAGGED_BY = 'Harsh Patel';
const APPLY = (typeof process !== 'undefined' && process.env && process.env.REMEDIATE_APPLY === '1');
const DRY_RUN = !APPLY;
const NOW = new Date();
const EXPIRES = new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000);
const TZ = 'America/New_York';

function fmtET(instant) {
  if (!instant) return null;
  const d = new Date(instant);
  if (isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date} ${time} ET`;
}
// Derive the scheduled UTC instant from legacy Eastern strings (June → EDT, UTC-4).
function legacyInstant(t) {
  const dStr = (t['Date of Interview'] || '').toString().trim();
  const tStr = (t['Start Time Of Interview'] || '').toString().trim();
  const dm = dStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const tm = tStr.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (!dm || !tm) return null;
  let hh = parseInt(tm[1], 10);
  const ap = tm[3].toUpperCase();
  if (ap === 'PM' && hh !== 12) hh += 12;
  if (ap === 'AM' && hh === 12) hh = 0;
  const iso = `${dm[3]}-${dm[1].padStart(2, '0')}-${dm[2].padStart(2, '0')}T${String(hh).padStart(2, '0')}:${tm[2]}:00-04:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}
function schedInstant(t) {
  return t.interviewStartAt ? new Date(t.interviewStartAt) : legacyInstant(t);
}
function norm(s) { return (s == null ? '' : s).toString().trim().toLowerCase().replace(/\s+/g, ' '); }
function deriveName(email) {
  const local = String(email || '').split('@')[0] || '';
  return local.split(/[._]/).filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}
function resolveEmailByName(name) {
  if (!name) return '';
  if (name.includes('@')) return name.trim().toLowerCase();
  const target = norm(name);
  const users = db.users.find({}, { email: 1, displayName: 1, name: 1 }).toArray();
  const found = users.find((u) => norm(u.displayName) === target || norm(u.name) === target || norm(deriveName(u.email)) === target);
  return found ? found.email.toLowerCase() : '';
}

print(`=== premature-meeting-start remediation v2 (${DRY_RUN ? 'DRY-RUN' : 'APPLY'}) ===`);

// 1 + 2: sweep currently-marked tasks → premature → clear + audit.
const marked = db.taskBody.find(
  { meetingStarted: true, meetingStartedAt: { $exists: true, $ne: null } },
  { meetingStartedAt: 1, meetingStartedBy: 1, interviewStartAt: 1, 'Candidate Name': 1, 'Date of Interview': 1, 'Start Time Of Interview': 1 }
).toArray();
let cleared = 0, skippedNoSchedule = 0;
marked.forEach((t) => {
  const sched = schedInstant(t);
  if (!sched) { skippedNoSchedule += 1; return; }
  const earlyMs = sched.getTime() - new Date(t.meetingStartedAt).getTime();
  if (earlyMs <= WINDOW_MS) return; // on-time or late mark — not premature
  const audit = {
    taskId: t._id,
    candidate: t['Candidate Name'] || null,
    scheduledAt: sched,
    scheduledEst: fmtET(sched),
    source: t.interviewStartAt ? 'interviewStartAt' : 'legacy',
    markedAt: t.meetingStartedAt,
    markedBy: norm(t.meetingStartedBy),
    earlyMinutes: Math.round(earlyMs / 60000),
    clearedAt: NOW,
    clearedBy: FLAGGED_BY,
    reason: 'premature (>60 min before scheduled start)'
  };
  print(`  - clear: ${audit.candidate} | by ${audit.markedBy} | sched ${audit.scheduledEst} (${audit.source}) | ${audit.earlyMinutes} min early`);
  if (DRY_RUN) return;
  db.taskBody.updateOne({ _id: t._id }, { $unset: { meetingStarted: '', meetingStartedAt: '', meetingStartedBy: '' } });
  db.meetingStartRemediations.updateOne(
    { taskId: t._id, markedBy: audit.markedBy },
    { $setOnInsert: audit },
    { upsert: true }
  );
  cleared += 1;
});
print(`swept ${marked.length} marked; cleared ${cleared} premature; skipped ${skippedNoSchedule} with no determinable schedule.`);

// 3: rebuild warnings + team-lead notifications from the FULL audit trail.
const audits = db.meetingStartRemediations.find({}).toArray();
const byOffender = {};
audits.forEach((a) => {
  const e = norm(a.markedBy);
  if (!e) return;
  (byOffender[e] = byOffender[e] || []).push(a);
});
print(`rebuilding warnings/notifications for ${Object.keys(byOffender).length} offender(s) from ${audits.length} audit row(s).`);

if (!DRY_RUN) {
  db.users.updateMany({ meetingStartWarning: { $exists: true } }, { $unset: { meetingStartWarning: '' } });
  db.notifications.deleteMany({ eventId: /^premature-meeting-start:/ });
}

Object.keys(byOffender).forEach((email) => {
  const rows = byOffender[email];
  // Always recompute from the stored instant (corrects v1's bad UTC-as-EST display).
  const meetings = rows.map((a) => ({ candidate: a.candidate || 'Candidate', scheduledEst: fmtET(a.scheduledAt) || a.scheduledEst || 'unknown time' }));
  const offenderUser = db.users.findOne({ email }, { teamLead: 1, displayName: 1, name: 1 });
  const offenderName = (offenderUser && (offenderUser.displayName || offenderUser.name)) || deriveName(email);
  const tlName = offenderUser && offenderUser.teamLead ? offenderUser.teamLead.toString().trim() : '';
  const tlEmail = resolveEmailByName(tlName);
  print(`  * ${email} (${offenderName}): ${rows.length} mark(s); teamLead "${tlName}" -> ${tlEmail || '(UNRESOLVED)'}`);
  meetings.forEach((m) => print(`      · ${m.candidate} — ${m.scheduledEst}`));
  if (DRY_RUN) return;

  db.users.updateOne(
    { email },
    { $set: { meetingStartWarning: { shownCount: 0, dismissed: false, reason: 'premature', meetings, clearedAt: NOW, by: FLAGGED_BY } } }
  );

  if (!tlEmail) { print('    !! team lead unresolved — notification skipped'); return; }
  const list = meetings.map((m) => `${m.candidate} (scheduled ${m.scheduledEst})`).join('; ');
  const description = `Flagged by ${FLAGGED_BY}. ${offenderName} (${email}) marked the following meeting(s) as "Started" well before their scheduled time: ${list}. Marking a meeting started before it begins misfeeds the information and is a breach of SOP. As their team lead it is your duty to verify what your team feeds into the system. We are clearing these marks from the record now.`;
  db.notifications.insertOne({
    recipient: tlEmail,
    eventId: `premature-meeting-start:${email}`,
    type: 'sop.meeting_start_warning',
    title: 'SOP breach: meeting marked started early',
    description,
    actor: FLAGGED_BY,
    link: null,
    candidateId: null,
    isRead: false,
    createdAt: NOW,
    expiresAt: EXPIRES
  });
});

print(DRY_RUN ? '=== DRY-RUN complete (no writes). Re-run with REMEDIATE_APPLY=1 to apply. ===' : `=== APPLIED: cleared ${cleared} new mark(s); rebuilt ${Object.keys(byOffender).length} offender warning(s)/notification(s). ===`);
