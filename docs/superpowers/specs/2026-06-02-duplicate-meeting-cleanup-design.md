# Duplicate-meeting cleanup — design

> Date: 2026-06-02
> Status: approved (brainstorming) — pending implementation plan
> Area: one-off ops script / Microsoft Graph / TasksToday meetings

## Problem

Before the idempotency fixes (PR #152 recognized the persisted link; PR #153
moved creation server-side behind an atomic claim), the TasksToday auto-create
effect created a **new Teams meeting on every reload** for tasks whose link it
didn't recognize. Each creation was a `POST /me/events` in the assigned
interviewer's mailbox, but our DB only ever stored the **last** link
(`meetingLink`/`joinUrl`/`joinWebUrl`) — overwriting the previous one. So:

- There is **no DB record** of the orphaned duplicate meetings.
- The duplicates exist only as calendar events in each interviewer's Outlook
  mailbox; attendees (including the candidate) may hold several live Teams
  invites for the same interview.

The new code prevents *new* duplicates. This script cleans up the *existing*
ones, safely.

## Decisions (locked with user)

- **Report-first, gated cancel.** Default mode is read-only and writes a report
  for human review. Cancellation is a separate, explicit pass that acts only on
  the reviewed report — never a blind scan-and-delete.
- **Scope: upcoming interviews only** (interview date ≥ today). Past duplicates
  are harmless clutter that ages out; upcoming ones are where multiple live
  invites actually confuse attendees.
- **Strict matching** (see below) to avoid cancelling unrelated meetings.

## Constraints discovered

- No DB list of duplicates → must scan the **organizer's** calendar via Graph.
- Headless calendar access requires the Azure app to have admin-consented
  **app-only `Calendars.ReadWrite` (application permission)**. The backend
  already mints an app-only token via `acquireTokenByClientCredential('.default')`
  for `sendApplicationMail`; whether the calendar application permission is
  granted is unverified. The report run **fails fast on 403**, surfacing the
  permission reality without side effects.

## Architecture

Single standalone script: `backend/scripts/cleanupDuplicateMeetings.mjs`
(matches `backfillPrtFields.js` / `c20-migrate-roles.mjs` conventions).

### Pure core (unit-tested)

`classifyTaskMeetings(task, calendarEvents) → { status, keep, duplicates, reason }`

- Filters `calendarEvents` to the task's meetings: `isOnlineMeeting === true`,
  `organizer.emailAddress.address` equals the interviewer, and `subject`
  **exactly equals** the task subject (the old `createOutlookEvent` set the
  event subject from the task, so an exact match is reliable).
- `status`:
  - `none` — 0 or 1 matching event → nothing to do.
  - `duplicates` — ≥2 matches AND exactly one matches the task's persisted link:
    `keep` = that event; `duplicates` = the rest.
  - `ambiguous` — ≥2 matches but none (or more than one) matches the persisted
    link → flagged for manual review; `duplicates` empty (never auto-cancel).
- No I/O; deterministic; the unit of correctness.

### Report mode (default, read-only)

1. Connect to Mongo. Select `taskBody` where a link exists
   (`meetingLink || joinUrl || joinWebUrl`) and the interview date ≥ today.
   Derive: interviewer email (`assignedToEmail`/`assignedTo`), interview
   start/end (same `moment.tz('America/New_York')` parse + formats as
   `Task.formatTask`), subject, candidate.
2. Acquire an app-only Graph token (client-credentials `.default`).
3. Per task: `GET /users/{email}/calendarView?startDateTime=&endDateTime=` over
   the interview window (± a small pad), then `classifyTaskMeetings`.
4. Write to the gitignored output dir `backend/scripts/out/` (repo is public + PII; the plan adds this path to `.gitignore`):
   - `*-report.html` — human-readable: task, candidate, interviewer, interview
     time, kept event (id + joinUrl), duplicates proposed for cancellation, and
     a separate "ambiguous / needs manual review" section.
   - `*-report.json` — machine-readable: per confirmed duplicate, `{ taskId,
     organizerEmail, eventId, subject, joinUrl }`. This is the ONLY input the
     cancel pass trusts.
5. Deletes nothing. On a Graph 403 for calendar access, abort with a clear
   "grant app-only Calendars.ReadWrite" message.

### Cancel mode (destructive, explicit)

`node cleanupDuplicateMeetings.mjs --cancel --from <report.json> --yes`

- Reads ONLY the JSON the report wrote. For each confirmed duplicate
  `{ organizerEmail, eventId }`, cancels via Graph
  (`POST /users/{email}/events/{id}/cancel` so attendees get a cancellation
  notice; falls back to `DELETE` if cancel is not applicable).
- Requires all three: `--cancel`, `--from <file>`, `--yes`. Missing any →
  refuses to act.
- Idempotent: a 404 (already gone) is logged and skipped, not an error.
- Never touches the kept event or ambiguous cases (they're not in the JSON).
- Logs every cancellation with task/event id.

## Output location & PII

The repo is public. Reports contain names, emails, and calendar data. Output
goes to `backend/scripts/out/`, which the plan adds to `.gitignore`. The script
must never write the report under a tracked path, and the PR must not commit
any report file. Verify `.gitignore` covers `backend/scripts/out/`.

## Library research

Microsoft Graph endpoints used (`/users/{id}/calendarView`,
`/users/{id}/events/{id}/cancel`, app-only client-credentials token) are
verified against current docs via Context7 before implementation. Reuses
`moment-timezone` (already a backend dep) for the interview-window parse.

## Testing

- `classifyTaskMeetings` unit tests: no-link/no-match (`none`); single match
  (`none`); two matches where one is canonical (`duplicates`, correct keep);
  none match the persisted link (`ambiguous`, empty duplicates); events with a
  different organizer or `isOnlineMeeting:false` or a different subject are
  excluded; the canonical event is never in `duplicates`.
- Report mode and cancel mode are thin glue; covered by a dry-run against a
  small real window after merge (operator-run), not by live-Graph unit tests.

## Out of scope

- Past interviews (scope is upcoming-only).
- Granting the Azure app-only `Calendars.ReadWrite` permission (an Azure admin
  action, outside the repo; the report run will tell us if it's missing).
- Any change to the live app's meeting flow (already shipped in #152/#153).
