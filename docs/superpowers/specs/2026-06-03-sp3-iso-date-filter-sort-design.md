# SP3 — ISO date filtering + sorting everywhere — design

> Date: 2026-06-03
> Status: approved (brainstorming) — pending implementation plan
> Area: Date-based **sorting + filtering** across Branch Candidates + Tasks Today, built on the existing ISO date fields. Phased: A (foundation) → B (sort) → C (filter), each its own PR. Phase A is specified in full; B/C outlined here and planned in detail when reached.

## 1. Problem

Users want to sort and filter by date across the app, but the date data is uneven:
- **Interviews** (`taskBody`): the canonical ISO fields **`interviewStartAt` / `interviewEndsAt`** already exist as proper BSON **`Date`** objects (UTC), populated on **~99.6%** of tasks (19,436 / 19,519). But they are **not indexed** and **no backend code reads them** — the app only uses the legacy `interviewDateTime` (an EST string, ~12% populated) in the fireflies scheduler. The display fields (`Date of Interview` MM/DD/YYYY, `Start/End Time Of Interview` "hh:mm A") remain.
- **Candidates** (`candidateDetails`): `poDate`/`updated_at`/`_last_write` are normalized to ISO on read, but **`eadStartDate` / `eadEndDate` / `marketingStartDate` / `ackEmailAt` are returned raw** (mixed ISO / locale / Date / null) → unreliable to sort/filter.

## 2. Decisions (locked with user)

- **Use `interviewStartAt` / `interviewEndsAt`** as the canonical interview sort/filter fields (they exist + are proper Dates). **No backfill, no per-query derivation.** The ~0.4% missing → null (sort last / excluded), optional fallback via the existing `computeInterviewDateTimeFromFields`.
- **Foundation first**, then sort, then filter, across **both** Branch Candidates and Tasks Today.
- **Filter UX:** EST-aware presets (Today / This week / This month / Last 30 days) **+ custom from–to range**.
- **Missing/unparseable dates** sort **last** and are **excluded** from range filters (never silently mis-bucketed).
- All date reasoning is **Eastern (America/New_York)** for display + preset boundaries; stored Dates are UTC and converted at the edges (moment-timezone, the app's existing Eastern formatter).

## 3. Phase A — date foundation (this PR)

### 3a. Index the interview Date fields
`backend/src/jobs/ensurePerfIndexes.js`: add
```js
await db.collection('taskBody').createIndex({ interviewStartAt: 1 });
await db.collection('taskBody').createIndex({ interviewEndsAt: 1 });
```
(idempotent, like the existing `createIndex` calls). Enables native indexed `Date` range queries for Phases B/C.

### 3b. Surface interview start/end in the task read mapper
`backend/src/models/Task.js` `formatTask(doc)` (~line 85): add to the returned object
- `interviewStartAt`: the raw `Date` → ISO string (or null) — `doc.interviewStartAt ? new Date(doc.interviewStartAt).toISOString() : null`.
- `interviewEndsAt`: same.
- `interviewStartEst`, `interviewEndEst`: the start/end formatted in Eastern (`moment.tz(value, 'America/New_York').format('MM/DD/YYYY h:mm A')` / `'h:mm A'`) for display, when present.
Leave the existing `Date of Interview` / `Start Time Of Interview` / `End Time Of Interview` / `interviewDateTime` fields untouched (back-compat).

### 3c. Normalize candidate dates to ISO on read
`backend/src/models/Candidate.js` `mapDocumentToCandidate` (and/or `candidateService.formatCandidateRecord`): add a small `toIsoDate(value)` helper and apply it to `eadStartDate`, `eadEndDate` (date-only → `YYYY-MM-DD`) and `toIso(value)` to `marketingStartDate`, `ackEmailAt` (datetime → full ISO). Helper accepts `Date | ISO string | MM/DD/YYYY | epoch | null` and returns the canonical string or `null` (never throws). `poDate`/`updated_at`/`_last_write` already normalized — leave as-is.
- On write: in `sanitizeCandidatePayload`, coerce `eadStartDate`/`eadEndDate` to `YYYY-MM-DD` (canonical going forward). (Validation already parses them; just store canonical.)

### 3d. Phase A is plumbing
No new sort/filter UI yet. User-visible effect: interview start/end available in EST in the task payload, and candidate dates returned in a consistent ISO form. Verify no frontend regression (the create form already uses `YYYY-MM-DD`; `new Date(...)` parses both forms).

## 4. Phase B — sorting (later PR, outline)
- Branch Candidates: extend `SORT_PRESETS` (`Candidate.js`) with date presets — Created (`_last_write`/createdAt), PO date (`poDate`), EAD end (`eadEndDate`), Marketing start (`marketingStartDate`) — plus the sort dropdown in `BranchCandidates.tsx`. Server-side `.sort()` with nulls-last semantics.
- Tasks Today: sort by `interviewStartAt` (asc/desc) — server-side, indexed.

## 5. Phase C — filtering (later PR, outline)
- Shared date-range control (presets + custom from–to), Eastern-aware: a preset resolves to an Eastern `[start, end)` which is converted to UTC for the query.
- Branch Candidates: a "date field" selector (Created / PO / EAD end / Marketing start) + range → server query on the normalized field.
- Tasks Today: range on `interviewStartAt` (replacing the tab-based exact-day match); plus time-of-day filters (start between X–Y EST) enabled by `interviewStartAt`/`interviewEndsAt`.

## 6. Testing (Phase A)
- `formatTask`: a doc with `interviewStartAt`/`interviewEndsAt` Dates → output has the ISO strings + correct EST display (e.g. `2026-06-03T13:00:00.000Z` → start `9:00 AM`); a doc missing them → nulls, no throw.
- `toIsoDate`/`toIso`: Date, `YYYY-MM-DD`, `MM/DD/YYYY`, null/garbage → expected canonical / null.
- `mapDocumentToCandidate`/`formatCandidateRecord`: `eadStartDate`/`eadEndDate` normalized to `YYYY-MM-DD`; mixed-format input normalized; null stays null. Existing candidate tests stay green.
- `ensurePerfIndexes`: the two new `createIndex` calls are issued (mock the collection).
- Frontend `tsc` clean; candidate/tasks views still render.

## 7. Out of scope
- Backfilling `interviewStartAt` (already ~99.6%); the scraper maintains it.
- Changing `interviewDateTime` / the fireflies scheduler (leave as-is).
- Phases B/C UI (separate PRs after A).

## 8. Risks
- **Frontend reads a candidate date in a now-changed format** → keep `eadStart/End` as `YYYY-MM-DD` (matches the form's date input); audit `candidate.ead*`/`marketingStartDate` reads before changing; `new Date()` parses both forms.
- **TZ correctness**: `interviewStartAt` is UTC; all EST conversion via moment-timezone `America/New_York` (DST-safe). Verified: `…T13:00:00Z` = 9:00 AM EDT.
- **~0.4% tasks without `interviewStartAt`** → null (sort last / excluded); acceptable, optional fallback exists.
