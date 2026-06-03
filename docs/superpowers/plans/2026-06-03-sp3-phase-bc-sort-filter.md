# SP3 Phases B & C — sort + filter — Implementation Plan

> REQUIRED SUB-SKILL: subagent-driven-development. Built on Phase A (interviewStartAt/EndsAt surfaced+indexed; candidate dates ISO-normalized). Spec: `docs/superpowers/specs/2026-06-03-sp3-iso-date-filter-sort-design.md` §4 (B), §5 (C). Backend ESM; Jest `node --experimental-vm-modules`. Each phase its own PR.

---

## PHASE B — sorting

### Task B1: Branch Candidates date-sort presets (server + dropdown)
**Files:** `backend/src/models/Candidate.js` (`SORT_PRESETS` ~line 84), `frontend/src/components/dashboard/BranchCandidates.tsx` (`sortBy` state ~462, type, the `<Select>` ~3947). Test: `backend/test/candidate.sortPresets.test.js`.
- Existing presets: `updated {_last_write:-1}`, `name`, `expiringIn {eadEndDate:1,_last_write:-1}`.
- [ ] Add presets: `marketingStart: { marketingStartDate: -1, _last_write: -1 }`, `poDate: { poDate: -1, _last_write: -1 }`. (EAD-end already = `expiringIn`; `updated` ≈ created.) Keep the whitelist pattern (no arbitrary sort).
- [ ] TDD: `resolveSort('marketingStart')` → `{ marketingStartDate:-1, _last_write:-1 }`; unknown key → default `updated`. (Export/test `resolveSort` or via the model.)
- [ ] Frontend: widen the `sortBy` union + add `<SelectItem>`s ("Marketing start (newest)", "PO date (newest)") to the existing dropdown; it already forwards `{ sort: sortBy }`. `tsc` clean.
- [ ] Note: DESC puts null/missing **last** naturally (acceptable). The existing `expiringIn` (ASC eadEnd) is unchanged.
- [ ] Commit `feat(sp3): Branch Candidates sort by marketing-start / PO date`.

### Task B2: Tasks Today sort by interview time
**Files:** read `frontend/src/pages/TasksToday.tsx` + `backend/src/models/Task.js` (`getTasksForUser` / the list query) to find the current sort. Test: extend a Task model/controller test.
- [ ] Add a server-side sort option `interviewStartAt` (asc/desc) to the tasks list query (whitelist, like candidates). Wire a small sort control in TasksToday (or reuse an existing one). DESC = upcoming-last / newest; ASC = soonest-first (the ~0.4% null interviewStartAt sort first on ASC — acceptable; document).
- [ ] If Tasks Today sorting is currently client-side, add client sort by `interviewStartAt` (the field is now in the payload from Phase A) — simpler, no server change. Pick whichever matches the existing pattern; prefer minimal change.
- [ ] TDD where a server change is made; `tsc` clean.
- [ ] Commit `feat(sp3): Tasks Today sort by interview start time`.

### Task B3: verify + PR
- [ ] Backend `test/candidate test/task` green; frontend `tsc` + relevant vitest green.
- [ ] PR `feat(sp3): date sorting — Branch Candidates + Tasks Today`. Merge (deploys when VM SSH block clears).

---

## PHASE C — filtering (presets + custom range)

### Task C1: Shared date-range control (frontend)
**Files:** Create `frontend/src/components/common/DateRangeFilter.tsx`. Test: `__tests__/DateRangeFilter.test.tsx`.
- [ ] Props: `value: { preset?: string, from?: string, to?: string }`, `onChange`. Presets: **Today / This week / This month / Last 30 days / Custom**. Custom shows two date inputs. A preset resolves (in the consumer, Eastern-aware) to an Eastern `[from, to)`.
- [ ] Provide a pure helper `resolveDateRange(preset, tz='America/New_York')` → `{ fromIso, toIso }` (UTC ISO bounds for the Eastern day/week/month) using moment-timezone. TDD this helper (Today → Eastern midnight→next midnight in UTC; This month → 1st→1st).
- [ ] `tsc` + vitest green. Commit `feat(sp3): shared DateRangeFilter component + Eastern range resolver`.

### Task C2: Tasks Today — interview date-range filter (server)
**Files:** `backend/src/models/Task.js` (the date-match / list query — currently tab-based exact-day on `Date of Interview` vs `receivedDateTime` ISO range), `frontend/src/pages/TasksToday.tsx`.
- [ ] Add an `interviewStartAt` **Date range** match (`{ interviewStartAt: { $gte: fromDate, $lt: toDate } }`) as a filter option; bounds are real `Date`s (indexed from Phase A). Mount `DateRangeFilter` in TasksToday; pass the resolved UTC bounds to the query. Missing `interviewStartAt` → excluded from the range (acceptable).
- [ ] TDD the query builder (range → `$gte/$lt` on `interviewStartAt`); `tsc` clean. Commit `feat(sp3): Tasks Today interview date-range filter`.

### Task C3: Branch Candidates — date-field + range filter (server)
**Files:** `backend/src/services/candidateService.js` / `backend/src/models/Candidate.js` (list query), `backend/src/sockets/candidateSocket.js` (pass filter args), `frontend/src/components/dashboard/BranchCandidates.tsx`.
- [ ] Add a filter: a **date-field selector** (Marketing start / PO date / EAD end / Created) + the `DateRangeFilter`. Server applies `{ [field]: { $gte, $lte } }` on the chosen field (EAD/marketing/po are Date; bounds are Date or `YYYY-MM-DD` to match storage — EAD/marketing stored as Date → use Date bounds). Whitelist the field name (no arbitrary field injection). Missing → excluded.
- [ ] TDD the candidate filter query; `tsc` clean. Commit `feat(sp3): Branch Candidates date-field range filter`.

### Task C4: verify + PR
- [ ] Backend + frontend suites green. PR `feat(sp3): date filtering — presets + custom range (Branch Candidates + Tasks Today)`. Merge.

---

## Notes / invariants
- All preset boundaries computed in **Eastern** (`America/New_York`, DST-safe) → converted to UTC for the query. `interviewStartAt`/`interviewEndsAt` are UTC Dates (Phase A indexed). Candidate EAD/marketing dates stored as Date.
- Whitelist sort keys + filter field names (never interpolate client strings into the query).
- Missing/unparseable dates: sort last (DESC) / excluded from ranges. Document where ASC surfaces nulls first.
- No AI-attribution trailers. Deploy is currently blocked by a VM-side port-22 firewall issue (devops) — code merges to main and ships when cleared.
