# Branch Candidates perf + unified timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Branch Candidates list load fast (kill the per-row user-directory N+1 + trim the payload) and show ONE complete, read-time-merged activity timeline per candidate in both the detail page and the Activity tab.

**Architecture:** P1 — a lean list formatter (no `getAllUsers` per row) + leaner projection; single list, client-side search unchanged; detail-on-click already served by `GET /:id`. P2 — a read-time aggregator that merges existing stores (createdAt, editHistory[], statusHistory[], assignmentEmails[], candidateactivities, interviews) into one sorted feed; no new write-path logging; rendered in both surfaces.

**Tech Stack:** Node ESM + Express 5 + raw Mongo (Jest); Vite + React 18 + TS (Vitest). Ship as TWO PRs: Part 1 (perf) then Part 2 (timeline).

---

## PART 1 — Faster list

### Task 1: Audit frontend field usage (read-only, no commit)

**Files:** read `frontend/src/components/dashboard/BranchCandidates.tsx`

- [ ] Grep every `candidate.<field>` / `c.<field>` read in BranchCandidates.tsx across: the table columns, `filteredCandidates` search, row-colour (`expiringRowClass`), badges (`needsMarketingInfo`), the inline **edit** dialog pre-fill, and the **move-to-marketing** flow.
- [ ] Produce the definitive **lean field set** = union of those reads. Note any field used ONLY by the edit dialog (e.g. `visaType`, `teamLead`, `eadStartDate/End`, `company`, `city`, `state`, `experienceYears`) — those will be fetched fresh from `GET /api/candidates/:id` when the dialog opens, NOT carried in the list payload.
- [ ] Record the finding as a comment in the next task's PR description. (No code yet.)

### Task 2: `formatCandidateListRecord` (kills the N+1)

**Files:**
- Modify: `backend/src/services/candidateService.js` (add method near `formatCandidateRecord` ~854)
- Test: `backend/test/candidateService.listRecord.test.js` (create)

- [ ] **Step 1 — failing test.** Assert: (a) for a candidate doc, the returned object has the lean fields (`id,name,email,technology,recruiter,recruiterRaw,expert,status,expiringInDays,needsMarketingInfo,updatedAt`); (b) **`userModel.getAllUsers` is NOT called** when formatting a list (spy → `toHaveBeenCalledTimes(0)`); (c) a non-marketing `user.role` (e.g. `expert`) gets PRT fields stripped (no `visaType`). Mock `userModel` with a `getAllUsers` jest.fn + `getUserByEmail`.

```js
// shape sketch
import { jest } from '@jest/globals';
// mock ../src/models/User.js => { userModel: { getAllUsers: jest.fn(()=>[]), getUserByEmail: ()=>null } }
// mock ../src/models/Candidate.js, ../src/config/database.js, logger as in sibling tests
const { candidateService } = await import('../src/services/candidateService.js');
const doc = { _id:{toString:()=>'c1'}, 'Candidate Name':'Asha', 'Email ID':'a@x.com', Technology:'SD', Recruiter:'rec@x.com', Expert:'e@x.com', status:'New', visaType:'H1B', eadEndDate:'2027-01-01', marketingStartDate:'2026-01-01' };
const lean = candidateService.formatCandidateListRecord(doc, { email:'mm@x.com', role:'mm' });
expect(lean).toMatchObject({ id:'c1', name:'Asha', email:'a@x.com', recruiterRaw:'rec@x.com' });
expect(userModel.getAllUsers).toHaveBeenCalledTimes(0);
const leanExpert = candidateService.formatCandidateListRecord(doc, { email:'e@x.com', role:'expert' });
expect(leanExpert.visaType).toBeUndefined();
```

- [ ] **Step 2 — run, confirm fail.**
- [ ] **Step 3 — implement.** Add the method. It mirrors `formatCandidateRecord`'s CHEAP parts only — NO `resolveTeamLeadEmail`/`_findEmailByName`/`getAllUsers`. Use the existing helpers `formatEmail`, `formatDisplayName`, `toTitleCase`, the derived-date math, and `this.missingMarketingFields(...)`; finish with `return this._applyPrtVisibility(lean, user);`. Field set per the Task-1 audit (default set in the spec §3a). Prefer stored `candidate.expiringInDays`/`daysInMarketing` (materialised by the scheduler) and fall back to the same date math `formatCandidateRecord` uses.

- [ ] **Step 4 — run, pass.**
- [ ] **Step 5 — commit:** `perf(candidates): lean list formatter (skips per-row user-directory lookups)`

### Task 3: Wire the four list fetch methods to the lean formatter

**Files:** Modify `backend/src/services/candidateService.js` (lines ~669, ~713, ~744, ~808 — the four `candidates.map(c => this.formatCandidateRecord(c, user))` in the list-fetch methods only).

- [ ] Change those four `.map` calls to `this.formatCandidateListRecord(candidate, user)`. **Do NOT** touch the single-record `formatCandidateRecord` calls at ~1151/1246/1318/1699 (detail/update/broadcast paths keep full formatting).
- [ ] Run `node --experimental-vm-modules node_modules/jest/bin/jest.js test/candidateService` — existing service tests still pass (scoping/counts unchanged).
- [ ] **Commit:** `perf(candidates): use lean list formatter in the four list-fetch paths`

### Task 4: Leaner LIST_PROJECTION

**Files:** Modify `backend/src/models/Candidate.js` (`LIST_PROJECTION`, ~57-63).

- [ ] Add `editHistory: 0` and `assignmentEmails: 0` to `LIST_PROJECTION` (it already excludes `source`, `metadata`, `statusHistory`, `attachments`). Confirm the lean formatter + `_applyPrtVisibility` don't read those.
- [ ] If the Task-1 audit found the edit dialog reads heavy fields from the list record: update the dialog to fetch `GET /api/candidates/:id` on open (small frontend change in `BranchCandidates.tsx`) — otherwise skip.
- [ ] `node --check` the model; run service tests.
- [ ] **Commit:** `perf(candidates): drop editHistory/assignmentEmails from the list projection`

### Task 5: Verify + PR (Part 1)

- [ ] Backend: `node --experimental-vm-modules node_modules/jest/bin/jest.js test/candidateService test/candidateController` green.
- [ ] Frontend: `cd frontend && npx tsc --noEmit` clean; `npx vitest run src/components/dashboard` green.
- [ ] Open PR `feat(perf): faster Branch Candidates list (kill per-row user-lookup N+1 + lean payload)`. Body: the N+1 root cause + the lean formatter + projection. **No AI-attribution trailers.** Merge + deploy + (user verifies load speed).

---

## PART 2 — One complete timeline

### Task 6: `getCandidateTimeline` aggregator

**Files:**
- Modify: `backend/src/services/candidateService.js` (add method near `getActivities` ~3081)
- Test: `backend/test/candidateService.timeline.test.js` (create)

- [ ] **Step 1 — failing test.** Given a candidate doc with `createdAt`, `editHistory:[{field:'expert',oldValue:'',newValue:'e@x.com',actor:'mm@x.com',ts:T1},{field:'status',...}]`, `statusHistory:[{from:'New',to:'Active',changedAt:T2,changedBy:'mm@x.com'}]`, `assignmentEmails:[{ts:T3,to:['rec@x.com'],cc:['tl@x.com'],subject:'Assignment: Asha',sender:'mm@x.com'}]`, plus mocked `candidateactivities` `[{type:'call_attempt',outcome:'connected',createdBy:{email:'e@x.com'},createdAt:T4}]` and interviews `[]`, assert the merged feed: is sorted newest-first; contains a `created` event, an `expert`/`field_changed` event ("Expert assigned"), a `status_changed` event ("New → Active"), an `assignment_email` event, and the `call_attempt`; and that **status is NOT duplicated** from editHistory (exactly one status event).

- [ ] **Step 2 — run, confirm fail.**
- [ ] **Step 3 — implement** `async getCandidateTimeline(user, candidateId)`:
  - Auth + read like other reads (reuse the pattern from `getCandidateById`/`getActivities`); fetch the candidate doc (default projection has editHistory/statusHistory/assignmentEmails), the `candidateactivities` (reuse `getActivities` logic or query directly), and interviews from `taskBody` (same query shape as `candidateController.getCandidateById` uses).
  - Map each source to `{ id, ts: Date, type, label, actor, detail, source }`. Skip `editHistory` entries with `field === 'status'` (dedup vs statusHistory). Friendly labels per field (`expert`→`Expert ${old?'changed':'assigned'}`, `teamLead`→'Team Lead set', `recruiter`→'Recruiter changed', else `${field} updated`).
  - `return timeline.sort((a,b) => b.ts - a.ts)`.
- [ ] **Step 4 — run, pass.**
- [ ] **Step 5 — commit:** `feat(prt): read-time candidate timeline aggregator (merges existing stores)`

### Task 7: Controller + route

**Files:** Modify `backend/src/controllers/candidateController.js` (add `getCandidateTimeline` near `getCandidateById`) + `backend/src/routes/candidates.js` (add route BEFORE the generic `/:id`). Test: `backend/test/candidateController.timeline.test.js` (mirror the getCandidateById harness; mock `candidateService.getCandidateTimeline`).

- [ ] Controller: 401 if no user; `const tl = await candidateService.getCandidateTimeline(req.user, req.params.id)`; `200 { success:true, timeline: tl }`; map `error.statusCode`.
- [ ] Route: `router.get('/:id/timeline', (req,res)=>candidateController.getCandidateTimeline(req,res));` placed with the other `/:id/...` specific routes (before the bare `/:id`).
- [ ] Test 200 happy path + 401/404 mapping. Run `test/candidateController`.
- [ ] **Commit:** `feat(prt): GET /api/candidates/:id/timeline`

### Task 8: `CandidateTimeline` component

**Files:** Create `frontend/src/components/candidates/CandidateTimeline.tsx`. Test: `frontend/src/components/candidates/__tests__/CandidateTimeline.test.tsx`.

- [ ] **Step 1 — failing test.** Mock `useAuth().authFetch` to resolve `{ success:true, timeline:[{id:'1',ts:'2026-06-02T...',type:'assignment_email',label:'Assignment email sent to rec@x.com',actor:'mm@x.com'},{id:'2',ts:'2026-06-01T...',type:'status_changed',label:'Status: New → Active',actor:'mm@x.com'}] }`. Assert both rows render, newest-first, with labels. Add an `onRefetch`-on-`newActivity` test if the component subscribes (optional — can rely on a prop/socket; keep simple).
- [ ] **Step 2 — run, fail.**
- [ ] **Step 3 — implement.** Props `{ candidateId: string }`. On mount, `authFetch(\`${API_URL}/api/candidates/${candidateId}/timeline\`)` → store `timeline`. Render a vertical list, each event: a per-`type` lucide icon + the `label` + actor + a formatted timestamp (reuse the app's date formatter). Loading + empty states. Per-type icon map: `created`→UserPlus, `status_changed`→RefreshCw, `assignment_email`→Mail, `expert`/`field_changed`→UserCog, `call_attempt`→Phone, `document_prepared`→FileCheck, `mock_interview`→GraduationCap, `interview`→Calendar.
- [ ] **Step 4 — tsc + vitest green.**
- [ ] **Step 5 — commit:** `feat(prt): CandidateTimeline component (unified feed)`

### Task 9: Mount in both surfaces

**Files:** Modify `frontend/src/pages/CandidateDetailPage.tsx` (replace the existing 3-kind timeline section with `<CandidateTimeline candidateId={id} />`) and `frontend/src/components/resume/CandidateActivityTab.tsx` (render the unified feed below the existing add-activity controls; refetch the timeline on the `newActivity` socket event so manual entries appear live).

- [ ] Wire both. Keep the Activity-tab "add activity" controls (call/doc/mock) — they still POST via the existing `addActivity` socket; after a successful add, refetch the timeline.
- [ ] `cd frontend && npx tsc --noEmit` clean; run the detail-page + activity-tab tests if present.
- [ ] **Commit:** `feat(prt): show the unified timeline on the candidate page + Activity tab`

### Task 10: Verify + PR (Part 2)

- [ ] Backend `test/candidateService test/candidateController` green; frontend tsc + vitest green.
- [ ] Open PR `feat(prt): one complete candidate activity timeline (read-time merge, both surfaces)`. Body: the "merge existing stores, no new logging" approach + the sources table. Merge + deploy + (user verifies an existing candidate shows full history).

---

## Notes / invariants
- Part 1 lands first and independently (perf win); Part 2 is additive (new endpoint + component).
- The timeline aggregator must NOT write anything — it derives from existing stores, so existing candidates show full history with no migration.
- Status events come from `statusHistory[]` only (drop editHistory `status` entries) to avoid duplicates.
- Do not regress scoping/counts in `getCandidatesForUser` (existing tests guard this).
- No AI-attribution trailers in any commit/PR.
