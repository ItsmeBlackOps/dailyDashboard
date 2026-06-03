# SP2 — Technical-Team Acknowledgment — design

> Date: 2026-06-03
> Status: approved (brainstorming) — pending implementation plan
> Area: one-time, versioned, per-user acknowledgment pop-up for the technical team

## 1. Problem

The technical team (experts and their technical managers/leads) should read and agree to a set of interview-support guidelines once. They read a fixed instructions block, tick "I agree", and Submit — that submission is the recorded acknowledgment. They are not prompted again unless the guidelines are revised (version bump). This is **not** an email and **not** per-meeting.

## 2. Decisions (locked with user)

- **Cadence:** one-time **per user**, re-prompted only when the instructions **version** changes.
- **Trigger:** shown **proactively on first authenticated load** (mounted at the app shell), independent of meetings.
- **Audience:** technical roles only — legacy tokens **`user` (expert)**, **`am` (technical assistant manager)**, **`lead` (technical team lead)**. Marketing roles (`mam`/`mlead`/`recruiter`), `mm`, and `admin` never see it. (`req.user.role` is already the legacy token after `authenticateHTTP`, so the gate lists legacy names.)
- **Content:** a **fixed, versioned text block** owned by the **server** (a backend constant), returned by the status endpoint so the frontend never drifts from the version. Bumping the version constant in a future deploy re-prompts everyone. v1 content drafted below (§7) for user review.
- **Gating:** the modal is dismissible **only by agreeing** (checkbox enables Submit). Closing/refreshing without agreeing re-shows it on the next load. It does **not** hard-lock navigation.
- **Storage:** a subdoc on the User record — `technicalAck: { version, agreedAt }`. No new collection.

## 3. Architecture (mirror the existing `/me/preferences` precedent)

The `eadEmailAlerts` feature (P4a) is the exact precedent: `routes/users.js` → `GET`/`PATCH /me/preferences` → `userController.getMyPreferences`/`updateMyPreferences` → `userModel.updateUser` with dot-notation `$set` (`'preferences.eadEmailAlerts'`) + `_source: 'self-preferences'`. SP2 mirrors this shape.

- **Backend constant** (`backend/src/config/technicalAck.js` or a constants module): `TECHNICAL_ACK = { version: 1, title, sections: string[] }`. `sections` is an array of plain-text paragraphs/bullets (no raw HTML — avoids injection and keeps rendering simple).
- **Routes** (`backend/src/routes/users.js`, next to the preferences routes):
  - `GET  /me/technical-acknowledgment` → `userController.getMyTechnicalAck`
  - `PATCH /me/technical-acknowledgment` → `userController.updateMyTechnicalAck`
  - (Full paths inherit the users router mount, e.g. `/api/users/me/technical-acknowledgment`.)
- **Controller** (`userController.js`, mirroring `getMyPreferences`/`updateMyPreferences`):
  - `getMyTechnicalAck`: read the user record; compute `required`; return status (see §5).
  - `updateMyTechnicalAck`: validate `version` equals the current server version; `$set technicalAck = { version, agreedAt: new Date() }` via `userModel.updateUser` dot-notation + `_source: 'self-technical-ack'`; return the updated status.
- **Frontend** (`TechnicalAckModal.tsx` + a mount in `DashboardLayout.tsx`): on first authenticated load, call `GET …`; if `required`, render the modal from the returned content; on Submit, `PATCH …` then close.

## 4. Data model

User record gains:
```
technicalAck: { version: number, agreedAt: ISO-8601 string }   // absent until first agreement
```
Not added to `User.AUDITED` (self-service, not an admin mutation). Updated only via the self endpoint (dot-notation `$set`, never overwriting sibling fields).

## 5. API contract

**`GET /api/users/me/technical-acknowledgment`** (auth required):
```jsonc
{
  "success": true,
  "required": true,                 // true iff role ∈ {user,am,lead} AND agreedVersion !== currentVersion
  "currentVersion": 1,
  "agreedVersion": 0,               // 0/null if never agreed
  "content": {                      // present only when required (else null/omitted)
    "version": 1,
    "title": "Technical Team — Interview Support Guidelines",
    "sections": ["…", "…"]
  }
}
```
Non-technical roles always get `required: false` (and no content).

**`PATCH /api/users/me/technical-acknowledgment`** (auth required), body `{ "version": 1 }`:
- 400 if `version` missing or `!== currentVersion` (prevents agreeing to a stale/forged version).
- On success: `$set technicalAck = { version, agreedAt }`; returns the same status shape with `required: false`.

## 6. Frontend

- `TechnicalAckModal.tsx` — shadcn `Dialog` (reuse the existing consent-dialog pattern, e.g. `MicrosoftConsentDialog`). Renders `content.title` + `content.sections` (mapped to list items/paragraphs), a single "I have read and agree" `Checkbox`, and a `Submit` button **disabled until the checkbox is ticked**. No other dismissal control (no X / no outside-click close) — agreeing is the only exit; otherwise it reappears next load.
- Mount in `DashboardLayout.tsx`: on mount (authenticated), `GET` the status; if `required`, open the modal. On Submit → `PATCH { version: content.version }` → close. Use `authFetch` + `parseJsonOrThrow`.

## 7. Draft v1 instructions content (REVIEW & EDIT before shipping)

> Drafted as a starting point per the user's request — **review and adjust to match the actual Technical-Team policy** before this ships. Stored as the `TECHNICAL_ACK` constant (version 1).

**Title:** Technical Team — Interview Support Guidelines

**Sections:**
1. Confidentiality — Treat all candidate information, resumes, and session details as strictly confidential. Do not share, store, or discuss them outside the assigned team.
2. Professional conduct — Join sessions on time, be prepared, and maintain a professional, respectful demeanor throughout.
3. No unauthorized recording — Do not record, screenshot, or redistribute any part of a session without explicit authorization.
4. Follow company process — Provide support within the scope and process defined for your assignment, and follow the instructions provided for each candidate.
5. Data handling — Access candidate data only as needed for your assigned sessions; do not export or retain it beyond what the process requires.
6. Escalation — Promptly report scheduling conflicts, candidate no-shows, conflicts of interest, or any concerns to your team lead.

*(Placeholder wording — the user will finalize. Changing the text after launch requires bumping the version constant to re-prompt the team.)*

## 8. Testing

- **Backend** (`userController` mirror tests):
  - `getMyTechnicalAck`: technical role + no `technicalAck` → `required: true` with content; technical role + `agreedVersion === currentVersion` → `required: false`, no content; non-technical role (e.g. `recruiter`, `mam`, `admin`) → `required: false` regardless.
  - `updateMyTechnicalAck`: valid `version` → writes `{version, agreedAt}`, returns `required: false`; missing/stale `version` → 400; idempotent (agreeing twice is safe).
- **Frontend** (`TechnicalAckModal.test.tsx`): renders only when `required`; Submit disabled until the checkbox is ticked; ticking + Submit calls `PATCH` with the current version; no close affordance other than agreeing.

## 9. Out of scope

- Per-meeting acknowledgment, the "meeting-started" timestamp/flag, and any acknowledgment **email** (explicitly dropped — this is a one-time in-app pop-up).
- Admin UI to edit the instructions (content is a versioned in-app constant; editing = a code change + version bump).
- An acknowledgment **history/log** (we store only the latest agreed version + timestamp; a per-version audit log is YAGNI for v1).
- SP3–SP7 (separate sub-projects).
