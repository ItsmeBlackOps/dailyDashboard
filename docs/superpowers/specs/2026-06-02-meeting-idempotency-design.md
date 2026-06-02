# Server-side idempotent meeting creation — design

> Date: 2026-06-02
> Status: approved (brainstorming) — pending implementation plan
> Area: TasksToday meetings / Microsoft Graph / Fireflies

## Problem

Each interview task should have **exactly one** Teams meeting. Today the
meeting is created client-side (`createOutlookEvent` in
`frontend/src/pages/TasksToday.tsx` → `POST https://graph.microsoft.com/v1.0/me/events`
with `isOnlineMeeting:true`), and an auto-create `useEffect` fires for any
visible task assigned to the user whose join link is missing.

The only guard that survives a page reload is the persisted join link — the
in-memory `autoMeetingAttemptedRef`/`autoMeetingInFlightRef` sets reset on
reload. Two prior bugs came from this:

1. The render/guard read only `joinUrl`/`joinWebUrl` while the flow persisted
   only `meetingLink` → every reload saw "no meeting" and created another.
   (Fixed in PR #152 by reading `meetingLink` and syncing the fields.)
2. Even with a durable guard, client-side creation has an inherent window:
   the meeting exists in Graph **before** our DB records it. A reload, a
   second browser tab, or two users acting on the same task can each create a
   meeting before any link is persisted.

This design closes the window by making creation **server-side, idempotent,
and atomically gated**, so concurrency and reloads cannot produce a second
meeting.

## Decision

**Full server-side creation** (chosen over a client-side claim/lock). The
backend owns creation end-to-end behind one idempotent endpoint, gated by an
atomic database claim.

The Azure dependency this normally implies is **already satisfied**:
`config.azure.meetingScopes` already includes both
`OnlineMeetings.ReadWrite` and `Calendars.ReadWrite`, and the existing OBO
flow (`graphMeetingService.setMeetingLobbyBypass`, used by the current
lobby-bypass endpoint) already acquires a token with those scopes and works in
production. So `Calendars.ReadWrite` is consented for OBO, and the backend can
create `/me/events` on the user's behalf without any new admin consent.

## Architecture

### New endpoint

`POST /api/tasks/:taskId/ensure-meeting`

- **Auth:** `requireHTTPRole` (the meeting-capable roles already used for the
  lobby-bypass route) plus the caller's delegated Graph token in the
  `x-graph-access-token` header (the OBO user assertion). Same pattern as
  `POST /api/graph/meetings/lobby-bypass`.
- **Body:** none required; the server derives the event from the task doc.
- **Response:**
  - `200 { created: false, meetingLink, joinUrl, joinWebUrl }` — a meeting
    already existed (idempotent short-circuit).
  - `201 { created: true, meetingLink, joinUrl, joinWebUrl }` — created now.
  - `202 { pending: true }` — another request currently holds the creation
    lock; caller should back off and re-read on its next poll.
  - `4xx/5xx { success:false, error }` — validation / Graph / OBO failure.

### Flow

1. Validate `taskId`; load the task.
2. **Short-circuit:** if `meetingLink || joinUrl || joinWebUrl` is already
   set, return it with `created:false`. No Graph call. (This alone stops
   reload duplication for any task that already has a meeting.)
3. **Atomic claim** — a single `findOneAndUpdate`:
   - filter: `{ _id, <no existing link>, $or:[ lock absent, lock older than LOCK_TTL ] }`
   - update: `{ $set: { meetingCreationLockAt: now, meetingCreationLockBy: email } }`
   - MongoDB guarantees only **one** concurrent caller performs this
     transition. A caller that gets `null` re-reads the task: if a link now
     exists → return it (`created:false`); otherwise a fresh lock is held by
     someone else → return `{ pending:true }`.
4. The winner creates the calendar event via OBO
   (`graphMeetingService.createEventMeeting(userAssertion, payload)` →
   `POST /me/events`), reads `created.onlineMeeting.joinUrl`.
5. Set lobby bypass = `everyone` (existing `setMeetingLobbyBypass`).
   **Best-effort:** a bypass failure is logged and surfaced as a soft warning
   but does **not** fail the request — the one meeting still exists and is
   persisted.
6. **Persist + release the lock atomically:**
   `$set { meetingLink: joinUrl, joinUrl, joinWebUrl: joinUrl, botStatus:'pending', botInviteAttempts:0, ... }`,
   `$unset { meetingCreationLockAt, meetingCreationLockBy }`.
7. **On any failure after the claim:** release the lock
   (`$unset meetingCreationLockAt/By`) so a later retry can proceed; return
   the error. Never leave a stuck lock except the LOCK_TTL safety net.

`LOCK_TTL` ≈ 3 minutes (stale-lock reclaim).

### Why this is 100%

Concurrent tabs, concurrent users, and reloads all funnel through the atomic
claim in step 3. Only one transitions the task into the locked state; every
other caller either returns the existing link (step 2) or backs off
(`pending`, step 3). There is no client-controlled window between "created in
Graph" and "recorded in our DB" — the backend does both before responding.

**Residual:** a backend crash *between* step 4 (Graph create) and step 6
(persist) leaves an orphaned Graph meeting; the task's lock is reclaimable
after `LOCK_TTL`, and a retry then creates the canonical one. This is
unavoidable without a 2-phase commit against Graph and is far rarer than the
client-close window the old design had.

## Server-side event payload

`graphMeetingService.createEventMeeting` reproduces the payload the client
builds today:

- `subject` from the task (sanitized).
- `body` (HTML) with Candidate / Client / Round, sanitized.
- `start`/`end` parsed from the task's interview times in the configured
  timezone (mirror the existing `Task.formatTask` start/end logic so the
  server computes the same window the client did).
- `attendees`: the same fixed list the client sends, including
  `fred@fireflies.ai` (the Fireflies bot) so the bot is invited via the
  calendar event exactly as in #149.
- `isOnlineMeeting: true`, `onlineMeetingProvider: 'teamsForBusiness'`,
  `location: { displayName: 'Microsoft Teams Meeting' }`.
- Endpoint: `POST https://graph.microsoft.com/v1.0/me/events` (OBO token).
- Returns `response.onlineMeeting.joinUrl`.

This preserves the #148/#149 behavior (single meeting, Fireflies bot invited,
lobby bypassed for everyone) — just relocated to the server.

## Client changes (`TasksToday.tsx`)

- `handleCreateMeeting` collapses to: acquire the Graph token (as today),
  `POST /api/tasks/:id/ensure-meeting` with `x-graph-access-token`, then update
  local state from the response (`meetingLink`/`joinUrl`/`joinWebUrl`), copy
  link + toast. It no longer calls Graph, persists the link, or hits
  lobby-bypass directly — the server does all of that.
- The auto-create `useEffect` keeps its guards (`extractJoinLink` skip,
  per-session attempted/in-flight refs, assigned-to-me check) and calls the
  endpoint instead of the old Graph logic. Because the endpoint is idempotent,
  a redundant call is harmless; because `extractJoinLink` now reads
  `meetingLink`, the effect won't even fire once a link exists.
- The `pending` response is treated as a no-op for this tick (the task will
  show its link on the next list refresh once the winning request persists).

## Back-compatibility / migration

No migration. Any task that already has `meetingLink`, `joinUrl`, or
`joinWebUrl` short-circuits at step 2 — it will never get a second meeting.
Tasks created by the legacy client path are therefore safe.

## Testing

Backend (Jest, ESM):

- `taskController.ensureMeeting`:
  - Short-circuits when the task already has a link — asserts **no** Graph /
    OBO call and `created:false`.
  - Happy path: claim → `createEventMeeting` → `setMeetingLobbyBypass` →
    persist link + clear lock; asserts the persisted `$set` carries
    `meetingLink/joinUrl/joinWebUrl` and the lock fields are unset.
  - Concurrency: when the atomic claim returns `null` and no link is present,
    responds `pending` and does **not** create.
  - Lobby-bypass failure is swallowed (still `created:true`, link persisted).
  - Graph/OBO create failure releases the lock and returns an error.
- `graphMeetingService.createEventMeeting`: payload shape (subject/body/start/
  end/attendees incl. Fireflies bot/`isOnlineMeeting`), posts to `/me/events`,
  extracts `onlineMeeting.joinUrl`.

Frontend: `tsc --noEmit` clean; existing TasksToday behavior preserved
(manual + auto create both routed through the endpoint).

## Out of scope

- Cleaning up duplicate meetings already created on calendars by the old
  behavior (separate one-off task if desired).
- Routing every other meeting surface through this endpoint (only TasksToday
  auto/manual creation is in scope here).
