# SP2 — "Meeting Started" toggle + Technical-Team acknowledgment — design

> Date: 2026-06-03
> Status: approved (brainstorming) — pending implementation plan
> Area: a per-meeting "Meeting Started" toggle for the technical team, plus a one-time, versioned acknowledgment that instructs them to use it.

## 1. Problem

Two coupled pieces:

- **Part A — "Meeting Started" toggle.** Today a task shows *Create meeting → Join*, but nothing records that the meeting actually started. The technical team must flip a **"Meeting Started"** toggle before starting each meeting; a meeting is **not considered started** unless they do. This is a **record-only** flag (started + who + when) — no gating, analytics, or status change.
- **Part B — one-time acknowledgment.** A one-time, per-user pop-up that makes the technical team aware of Part A: they read the instruction, tick "I agree", and Submit. That submission is the recorded acknowledgment. They are not prompted again unless the instruction's version is bumped.

The two are coupled by **content only** (the acknowledgment tells them about the toggle); they are independent in code and ship together in SP2.

## 2. Decisions (locked with user)

**Part A (toggle):**
- **Effect:** record-only — sets `meetingStarted`/`meetingStartedAt`/`meetingStartedBy`. No gating, no analytics, no task-status change.
- **Direction:** **one-way** — once marked started it stays set (no un-toggle in the UI; admin corrects mistakes out-of-band). The endpoint is idempotent.
- **Who can mark:** the task's **assigned expert** marks their own; **`am`/`lead`/`admin`** may mark any task they can see. Marketing roles cannot.
- **Where:** on the TasksToday row, beside the existing Create-meeting/Join control, on the same (interview-support) rows that show the meeting button.

**Part B (acknowledgment):**
- **Cadence:** one-time per user, re-prompted only on a version bump.
- **Trigger:** proactively on first authenticated load (mounted at the app shell), independent of meetings.
- **Audience:** technical roles only — legacy tokens **`user` (expert)**, **`am`**, **`lead`**. Marketing (`mam`/`mlead`/`recruiter`), `mm`, and `admin` never see it. (`req.user.role` is already the legacy token after `authenticateHTTP`.)
- **Content:** a fixed, **versioned** text block owned by the server (a backend constant), returned by the status endpoint so the frontend never drifts. Content is the single toggle instruction (§7).
- **Gating:** the modal is dismissible **only by agreeing**; closing/refreshing without agreeing re-shows it next load; it does not hard-lock navigation.
- **Storage:** `technicalAck: { version, agreedAt }` subdoc on the User record. No new collection.

## 3. Architecture

### Part A — Meeting Started toggle

Mirrors the existing task-meeting endpoints (`PATCH /:taskId/meeting-link`, `POST /:taskId/ensure-meeting` in `backend/src/routes/tasks.js` → `taskController`; `Task.saveMeetingLinks` is the meeting-field writer; `Task.formatTask` spreads fields onto the API payload).

- **Model (`backend/src/models/Task.js`):** new method `markMeetingStarted(taskId, actorEmail)` mirroring `saveMeetingLinks` — `$set { meetingStarted: true, meetingStartedAt: <ISO>, meetingStartedBy: actorEmail }` **only when not already started** (one-way; idempotent — a second call returns the existing state without changing the timestamp). `formatTask` already spreads `{ ...doc }`, so the three fields appear in task payloads with no projection change (confirm they aren't `$unset` in the list aggregation — if they are, add them to the projection).
- **Controller (`taskController.js`):** `markMeetingStarted = asyncHandler(...)` — resolve `req.user`; load the task; **gate**: allow if `actor.role === 'admin'`, or `actor.role ∈ {am, lead}`, or (`actor.role === 'user'` AND `actor.email === assignedEmail`). Otherwise 403. On allow → `Task.markMeetingStarted(taskId, actor.email)`; return the updated meeting-started fields. The task's assigned expert is `doc.assignedTo` (fallbacks `AssignedExpert`/`assignedExpert`); `formatTask` already normalizes it to `assignedEmail` (lower-cased when it contains `@`), so compare against that. Reuse the task load the existing meeting controller already does.
- **Route (`backend/src/routes/tasks.js`):** `router.patch('/:taskId/meeting-started', taskController.markMeetingStarted);` (PATCH per the new REST convention — an idempotent, one-way partial update of the task's meeting-started sub-state; no body required, optional `{ started: true }`).
- **Frontend (`frontend/src/pages/TasksToday.tsx`):** beside the meeting button —
  - `task.meetingStarted === true` → a disabled **"Started ✓"** chip (tooltip: `meetingStartedBy` + `meetingStartedAt`), shown to everyone who sees the row.
  - else, for allowed togglers (assigned expert / `am` / `lead` / `admin`) → a **"Mark started"** button → `authFetch` `PATCH .../meeting-started` → on success update the row in place (`meetingStarted`, `meetingStartedAt`, `meetingStartedBy`). Non-togglers see a muted "Not started".

### Part B — acknowledgment (mirror the `/me/preferences` precedent)

`eadEmailAlerts` (P4a) is the precedent: `routes/users.js` → `GET`/`PATCH /me/preferences` → `userController.getMyPreferences`/`updateMyPreferences` → `userModel.updateUser` dot-notation `$set` + `_source`.

- **Backend constant** (`backend/src/config/technicalAck.js` or a constants module): `TECHNICAL_ACK = { version: 1, title, sections: string[] }` (plain-text sections — no raw HTML).
- **Routes (`routes/users.js`, beside the preferences routes):** `GET /me/technical-acknowledgment` → `getMyTechnicalAck`; `PATCH /me/technical-acknowledgment` → `updateMyTechnicalAck`. (Full paths inherit the users-router mount.)
- **Controller (`userController.js`, mirroring the preferences pair):** `getMyTechnicalAck` computes status (§5); `updateMyTechnicalAck` validates `version === currentVersion` then `$set technicalAck = { version, agreedAt }` via `userModel.updateUser` dot-notation + `_source: 'self-technical-ack'`.
- **Frontend:** `TechnicalAckModal.tsx` (reuse the consent-dialog pattern, e.g. `MicrosoftConsentDialog`) mounted in `DashboardLayout.tsx`; on first authenticated load `GET` the status; if `required`, render the modal from the returned content; on Submit → `PATCH { version }` → close.

## 4. Data model

- **Task:** `meetingStarted: boolean`, `meetingStartedAt: ISO-8601 | null`, `meetingStartedBy: email | null` (absent/false until first marked).
- **User:** `technicalAck: { version: number, agreedAt: ISO-8601 }` (absent until first agreement; not in `User.AUDITED` — self-service).

## 5. API contracts

**`PATCH /api/tasks/:taskId/meeting-started`** (auth required), body optional `{ "started": true }`:
- 403 if the actor isn't allowed (see gate). 404 if task missing.
- On success: marks started (idempotent) and returns `{ success: true, meetingStarted: true, meetingStartedAt, meetingStartedBy }`.

**`GET /api/users/me/technical-acknowledgment`** (auth required):
```jsonc
{ "success": true, "required": true, "currentVersion": 1, "agreedVersion": 0,
  "content": { "version": 1, "title": "…", "sections": ["…"] } }  // content present only when required
```
Non-technical roles → `required: false`, no content.

**`PATCH /api/users/me/technical-acknowledgment`** (auth required), body `{ "version": 1 }`:
- 400 if `version` missing or `!== currentVersion`.
- On success: `$set technicalAck = { version, agreedAt }`; returns the status shape with `required: false`.

## 6. Error handling

- Toggle: 403 (not allowed), 404 (no task), 500 (write failure) with a logged error; idempotent re-mark is a 200 no-op.
- Ack: 400 on stale/missing version; non-technical role → benign `required:false` (not an error). Frontend surfaces server messages via `parseJsonOrThrow`.

## 7. Acknowledgment content (v1)

Stored as the `TECHNICAL_ACK` constant, version `1`:

**Title:** Technical Team — Before You Start Meetings

**Sections:**
1. You must toggle the **"Meeting Started"** button before starting each meeting.
2. This is **mandatory** — a meeting will **not** be considered started unless you toggle it.

*(Changing this wording after launch requires bumping the version constant to re-prompt the team.)*

## 8. Testing

**Part A (backend):** `Task.markMeetingStarted` sets the three fields once and is idempotent (second call keeps the original timestamp); `taskController.markMeetingStarted` — assigned expert marks own → 200; non-assigned `user` → 403; `am`/`lead`/`admin` → 200; marketing role → 403; missing task → 404.
**Part A (frontend):** row shows "Mark started" for an allowed toggler when not started; clicking calls the PATCH and flips to "Started ✓"; a started task shows the disabled chip; a non-toggler sees no action.

**Part B (backend):** `getMyTechnicalAck` — technical role + no/stale `technicalAck` → `required:true` + content; matching version → `required:false`, no content; non-technical role → always `required:false`. `updateMyTechnicalAck` — valid version writes `{version, agreedAt}` and returns `required:false`; missing/stale version → 400; idempotent.
**Part B (frontend):** `TechnicalAckModal` renders only when `required`; Submit disabled until the checkbox is ticked; ticking + Submit calls PATCH with the current version; no dismissal other than agreeing.

## 9. Out of scope

- Per-meeting acknowledgment, meeting-started **gating/analytics/status change**, and any acknowledgment **email** (all explicitly dropped).
- Un-toggling "Meeting Started" from the UI (one-way; admin corrects out-of-band).
- Admin UI to edit the acknowledgment text (versioned in-app constant; editing = code change + version bump).
- An acknowledgment history/log (store only the latest agreed version + timestamp).
- SP3–SP7 (separate sub-projects).
