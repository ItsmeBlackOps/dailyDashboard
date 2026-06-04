# Premature Meeting-Start Remediation — Design

> Date: 2026-06-04. Branch: `feat/premature-meeting-start-remediation`.

## Problem

Experts mark a task's meeting as **Started** (`PATCH /api/tasks/:taskId/meeting-started`) far too early.
`markMeetingStarted` (taskController.js:322) gates by role/assignment and is idempotent, but has **no
time-window guard** — so any future meeting can be marked "started", misfeeding interview status.

**Evidence (Atlas `interviewSupport.taskBody`, 60-min window):** 5 marks made >60 min before the
scheduled `interviewStartAt`, by 2 experts — some ~20 h early:

| Expert (`meetingStartedBy`) | Meetings | Team lead |
|---|---|---|
| `rahul.agarwal@vizvainc.com` | Meka Priyanka, Sajitha Shaik, Aditya Desai, Simran Mhaske (4) | Prateek Narvariya |
| `amartya.kumar@vizvainc.com` | Divya Sree Pulipati (1) | Prateek Narvariya |

`interviewStartAt` is a real BSON Date (UTC = Eastern wall-clock), ~99.6 % populated.

## Decisions (locked with user)

1. **Markable window = 60 minutes** (user chose 1 h for safety). A meeting may only be marked started
   within 60 min of its scheduled `interviewStartAt`.
2. **Add a prevention guard** to `markMeetingStarted` (root-cause fix). Reject (400 `TOO_EARLY`) when the
   meeting is more than 60 min in the future.
3. **Cleanup scope = the premature marks only** — meetings marked >60 min before their scheduled start.
   Leave the ~30 marked tasks that have no `interviewStartAt` (can't judge; likely legacy/legitimate).
4. **Expert warning** = a pop-up shown on the offender's next **3** loads, then it disappears.
5. **Team-lead warning** = a single in-app notification per offending expert, attributed to **Harsh Patel**.

## Scope — four parts

### Part 1 — Prevention guard (`backend/src/controllers/taskController.js`)
In `markMeetingStarted`, after the idempotency check (already-started → success) and before the write,
reject when the meeting is too far out:

```js
const MARK_WINDOW_MS = 60 * 60 * 1000; // 60 min
if (task.interviewStartAt) {
  const msUntilStart = new Date(task.interviewStartAt).getTime() - Date.now();
  if (Number.isFinite(msUntilStart) && msUntilStart > MARK_WINDOW_MS) {
    const minutes = Math.ceil(msUntilStart / 60000);
    return res.status(400).json({
      success: false, code: 'TOO_EARLY',
      error: `This meeting is scheduled in ~${minutes} min. You can mark it started only within 60 minutes of the start time.`,
    });
  }
}
```
Tasks without `interviewStartAt` are unaffected (can't judge → allow, as today).

### Part 2 — Expert 3× warning (mirrors the one-time-ack pattern)
- **Config** `backend/src/config/meetingStartWarning.js` — `MEETING_START_WARNING = { title, maxShows: 3, body: [...] }`.
- **User subdoc** `meetingStartWarning` — `{ shownCount, dismissed, reason, meetings:[{candidate, scheduledEst}], clearedAt, by }`.
  The mere **presence** of this subdoc arms the warning (only the offenders get it seeded). No version needed (one-shot).
- **`formatCachePayload`** (User.js:54) — add `meetingStartWarning: userDoc.meetingStartWarning || null` so the GET reads it from the cache (this omission is exactly what broke the ack re-show before).
- **GET `/api/users/me/meeting-start-warning`** — `required = !!subdoc && !dismissed && shownCount < 3`; returns `content {title, body, meetings}` when required, else `null`. No role gate (subdoc presence is the gate).
- **PATCH `/api/users/me/meeting-start-warning`** — increments `shownCount` (cap 3), sets `dismissed` when it reaches 3, stamps `lastShownAt`. Increment on **dismiss** (a button click), not on render (robust against StrictMode/remount double-counts).
- **Routes** (`backend/src/routes/users.js`, after line 21) — `router.get`/`router.patch` for the two handlers.
- **Frontend** `frontend/src/components/MeetingStartWarningModal.tsx` — mirrors `TechnicalAckModal`: fetch on mount, show when `required`, list the meetings, single **"I understand"** button → PATCH → close. Mounted globally in `DashboardLayout.tsx` beside `<TechnicalAckModal />`.

### Part 3 — Team-lead 1× notification + Part 4 — cleanup (one-time remediation)
A committed mongosh script `backend/scripts/remediate-premature-meeting-starts.mongo.js`, run once **after the
guard deploys** (so cleared marks can't be immediately re-added). It:
1. Finds premature marks (`meetingStarted:true`, `interviewStartAt` present, `interviewStartAt - meetingStartedAt > 60 min`).
2. **Un-marks** each: `$unset meetingStarted, meetingStartedAt, meetingStartedBy`; inserts an audit row into a new
   `meetingStartRemediations` collection (`taskId, candidate, scheduledAt, markedAt, markedBy, clearedAt, by:'Harsh Patel'`).
3. **Seeds** each offender's `users.meetingStartWarning` subdoc (`shownCount:0, dismissed:false, meetings:[…], clearedAt, by:'Harsh Patel'`).
4. **Creates one team-lead notification** per offender (resolve teamLead display-name → email), inserted into
   `notifications` with a deterministic `eventId` (`premature-meeting-start:<offender>`) for idempotency, and a
   far-future `expiresAt` (90 days) so it survives the default 7-day TTL.

**Team-lead message (from Harsh Patel):**
> *Flagged by Harsh Patel.* `<Expert>` marked the following meetings as **Started** well before their scheduled
> time: `<list: candidate — scheduled EST>`. Marking a meeting started before it begins misfeeds the information
> and is treated as a **breach of SOP**. As their team lead it is your duty to verify what your team feeds into
> the system. We are clearing these marks from the record now.

**Expert message:** "You marked one or more meetings as Started well before their scheduled time. This misfeeds
the information and is a breach of SOP. Only toggle Meeting Started within 60 minutes of the scheduled start. We
have cleared these incorrect marks from the record." + the list of their meetings.

## Sequencing (note: deploy currently blocked on port-22)
1. Land the **code** (guard + warning infra + frontend) via PR → deploys when the SSH/port-22 flake clears.
2. **After** the guard is live, run the remediation script (un-mark + seed warnings + team-lead notifications).
   Running cleanup post-guard prevents an expert re-marking a just-cleared future meeting.

## Out of scope
- The ~30 marked tasks without `interviewStartAt` (undeterminable).
- Any change to the markable window for tasks that lack a scheduled time.

## Verification
- Jest: guard rejects >60 min future / allows ≤60 min / allows missing `interviewStartAt` / still idempotent;
  GET required-vs-not by shownCount; PATCH increments + dismisses at 3; `formatCachePayload` carries the subdoc.
- Vitest: modal shows when required, lists meetings, "I understand" PATCHes + closes; hidden when not required.
- Manual/DB: after remediation, the 5 tasks have no `meetingStarted`; 2 `meetingStartRemediations` audit rows ×5;
  2 offenders carry `meetingStartWarning`; Prateek has 2 notifications.
