# SP3 Phase A — date foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Checkbox steps. Full design in `docs/superpowers/specs/2026-06-03-sp3-iso-date-filter-sort-design.md` §3.

**Goal:** Foundation for date sort/filter — index + surface the existing `interviewStartAt`/`interviewEndsAt` ISO `Date` fields (in EST), and normalize candidate dates to a consistent ISO form on read. No new UI (Phases B/C). Backend ESM; Jest via `node --experimental-vm-modules`.

---

### Task 1: Index `interviewStartAt` / `interviewEndsAt`
**Files:** Modify `backend/src/jobs/ensurePerfIndexes.js` (alongside the existing `taskBody` `createIndex` calls, ~line 9-13).
- [ ] Add:
```js
await db.collection('taskBody').createIndex({ interviewStartAt: 1 });
await db.collection('taskBody').createIndex({ interviewEndsAt: 1 });
```
- [ ] If there is a test for ensurePerfIndexes, assert the two calls; else `node --check`.
- [ ] Commit: `perf(tasks): index interviewStartAt/interviewEndsAt`

### Task 2: Surface interview start/end (EST) in `formatTask`
**Files:** Modify `backend/src/models/Task.js` `formatTask(doc)` (~line 85). Test: `backend/test/task.formatTask.dates.test.js` (create, or extend an existing Task test).
- [ ] **Failing test:** a doc with `interviewStartAt: new Date('2026-06-03T13:00:00.000Z')`, `interviewEndsAt: new Date('2026-06-03T13:30:00.000Z')` → `formatTask` returns `interviewStartAt: '2026-06-03T13:00:00.000Z'`, `interviewEndsAt: '...T13:30:00.000Z'`, `interviewStartEst` containing `9:00 AM`, `interviewEndEst` containing `9:30 AM`. A doc with neither → those four are `null`, no throw. (Confirm the Eastern formatter import used elsewhere in the file — likely `moment-timezone` with `America/New_York`; reuse it.)
- [ ] Run → fail.
- [ ] Implement: add to the returned object:
```js
interviewStartAt: doc.interviewStartAt ? new Date(doc.interviewStartAt).toISOString() : null,
interviewEndsAt:  doc.interviewEndsAt  ? new Date(doc.interviewEndsAt).toISOString()  : null,
interviewStartEst: doc.interviewStartAt ? moment(doc.interviewStartAt).tz('America/New_York').format('MM/DD/YYYY h:mm A') : null,
interviewEndEst:   doc.interviewEndsAt  ? moment(doc.interviewEndsAt).tz('America/New_York').format('h:mm A') : null,
```
(Use whatever moment-tz import the file already has; if none, mirror the import used by `TasksToday`/`firefliesBotScheduler`.) Leave existing fields untouched.
- [ ] Run → pass. Run the broader Task suite (`test/task` / `test/taskController`) — no regression.
- [ ] Commit: `feat(tasks): surface interviewStartAt/EndsAt (+ EST display) in formatTask`

### Task 3: Normalize candidate dates to ISO on read + write
**Files:** Modify `backend/src/models/Candidate.js` (`mapDocumentToCandidate`) and/or `backend/src/services/candidateService.js` (`formatCandidateRecord`, `sanitizeCandidatePayload`). Test: `backend/test/candidate.dateNormalize.test.js` (create).
- [ ] **Failing test:** add a `toIsoDate`/`toIso` helper (exported or tested via the mapper). Cases: `new Date('2026-06-03')` → `'2026-06-03'`; `'2026-06-03'` → `'2026-06-03'`; `'06/03/2026'` → `'2026-06-03'`; `''`/`null`/`'garbage'` → `null`. And: `mapDocumentToCandidate({ eadStartDate:'06/03/2026', eadEndDate:new Date('2027-06-03'), marketingStartDate:new Date('2026-01-02T00:00:00Z') })` → `eadStartDate:'2026-06-03'`, `eadEndDate:'2027-06-03'`, `marketingStartDate` a full ISO string.
- [ ] Run → fail.
- [ ] Implement a robust helper (no throw): `Date` → ISO; ISO/`YYYY-MM-DD` passthrough; `MM/DD/YYYY` → `YYYY-MM-DD` (use moment with explicit formats + strict parse); else `null`. Apply `toIsoDate` to `eadStartDate`/`eadEndDate` (date-only `YYYY-MM-DD`) and `toIso` to `marketingStartDate`/`ackEmailAt` (full ISO) in the read mapper. In `sanitizeCandidatePayload`, store `eadStartDate`/`eadEndDate` as canonical `YYYY-MM-DD` going forward. **Do not** change `poDate`/`updated_at`/`_last_write`.
- [ ] **Frontend safety:** grep `candidate.eadStartDate|eadEndDate|marketingStartDate|ackEmailAt` reads in the frontend; confirm they parse `YYYY-MM-DD`/ISO (date inputs + `new Date()` do). Note any that would break (none expected).
- [ ] Run → pass; run `test/candidateService test/candidateController` — green.
- [ ] Commit: `feat(candidates): normalize ead/marketing/ack dates to ISO on read + write`

### Task 4: Verify + PR
- [ ] Backend `test/task test/candidate test/candidateService test/candidateController` green; `node --check` changed files.
- [ ] Frontend `cd frontend && npx tsc --noEmit` clean.
- [ ] PR `feat(sp3): date foundation — index + surface interviewStartAt/EndsAt (EST), normalize candidate dates`. Body: the field findings (interviewStartAt ~99.6% Date, unindexed/unread; candidate dates inconsistent) + that this unblocks Phases B/C. **No AI-attribution trailers.** Merge + deploy.

---

## Notes
- `interviewStartAt`/`interviewEndsAt` are UTC `Date`s; all EST conversion via moment-timezone `America/New_York`.
- Phase A is plumbing — no sort/filter UI yet (Phases B/C).
- Keep `interviewDateTime` + the fireflies scheduler untouched.
