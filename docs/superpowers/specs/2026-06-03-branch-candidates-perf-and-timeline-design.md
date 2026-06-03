# Branch Candidates — faster load + one complete activity timeline — design

> Date: 2026-06-03
> Status: approved (brainstorming) — pending implementation plan
> Area: Branch Candidates list load performance + a unified, complete candidate activity timeline. Two independent workstreams, one spec; shipped as two PRs (perf first).

## 1. Problem

**P1 — list loads slowly.** `getBranchCandidates` (socket) → `candidateService.getCandidatesForUser` fetches ALL in-scope candidates (no limit; ~1,400+ for marketing managers/admin) and runs `formatCandidateRecord` on every row. Each row calls `resolveTeamLeadEmail → _findEmailByName → userModel.getAllUsers()`, which rebuilds an array of all users (object-spreading each to strip the password hash) and linearly scans it — an O(candidates × users) per-load cost with heavy allocation/GC. The response also ships fields the list never displays (`editHistory[]`, `assignmentEmails[]`, all PRT internals). The list does **not** display `teamLead`, so the expensive resolution is pure waste for the list.

**P2 — the activity timeline is fragmented and incomplete.** Two disjoint views exist: the candidate detail page shows *created + statusHistory + interviews*; the Activity tab (`CandidateActivityTab`) shows *call_attempt / document_prepared / mock_interview / task_created / task_recreated* from the `candidateactivities` collection. Several lifecycle events appear in **neither**: assignment email sent, expert assigned, team-lead/recruiter/visa changes, and status changes (these live in `statusHistory[]`, not the activity feed). Users want **one complete timeline** per candidate.

## 2. Decisions (locked with user)

- **P1:** Keep a single list (no list/detail split — `GET /api/candidates/:id` already serves full detail on click). Fix = a **lean list formatter** that skips the per-row user-directory lookups + a **leaner projection**. **No server-side pagination** — all rows load (lean) so client-side search stays instant and complete (search responds immediately, no per-keystroke round-trip).
- **P2:** **Do not add new write-path activity logging.** Every wanted event is already persisted (createdAt, `editHistory[]`, `statusHistory[]`, `assignmentEmails[]`, `candidateactivities`, `taskBody` interviews). Build **one read-time aggregator** that merges these into a single sorted feed — complete for existing AND new candidates, no migration, self-maintaining. Render the **same unified timeline in both** the candidate detail page and the Activity tab.

## 3. Design — P1: faster Branch Candidates

### 3a. Lean list formatter (kills the N+1)
Add `candidateService.formatCandidateListRecord(candidate, user)` returning only what the list view needs, computed cheaply with **no `getAllUsers()` / `_findEmailByName` / `resolveTeamLeadEmail` call**:
```
{ id, name, email, contact, technology,
  recruiter: <display>, recruiterRaw: <email>,   // via formatDisplayName(email) — string-only, no directory lookup
  expert: <display>, expertRaw: <email>,
  status, workflowStatus, resumeUnderstandingStatus,
  expiringInDays, daysInMarketing,               // prefer stored materialised values; else cheap date math
  needsMarketingInfo, missingMarketingFields,
  updatedAt, _last_write, branch, poDate }
```
Apply the existing `_applyPrtVisibility(lean, user)` so non-marketing roles still get PRT fields stripped. The four list fetch methods (`candidateService.js` lines ~669, ~713, ~744, ~808) switch their `.map(c => formatCandidateRecord(c, user))` to `formatCandidateListRecord`. Single-record paths (detail, post-update broadcast) keep the full `formatCandidateRecord`.

### 3b. Leaner projection
Tighten `LIST_PROJECTION` (`Candidate.js`) to additionally exclude `editHistory` and `assignmentEmails` (it already drops `source`, `metadata`, `statusHistory`, `attachments`). Keep the lean-field set + the PRT fields the formatter/visibility need.

### 3c. Frontend field-dependency audit (safety)
Before trimming, grep every `candidate.<field>` read in `BranchCandidates.tsx` (table, search, row colour, badges, the inline edit dialog, the move-to-marketing flow). Any field used there must be in the lean set; anything heavier (e.g. the edit dialog needing `visaType`/`teamLead`/EAD) must instead **fetch fresh via `GET /api/candidates/:id`** when the dialog opens. Search is unchanged (client-side over the lean-but-complete set → instant).

### 3d. Out of scope for P1
Server-side pagination; virtualization (only 50 rows render via existing client pagination — render is not the bottleneck); write-time materialisation of display fields (revisit only past ~5k rows).

## 4. Design — P2: one complete timeline (read-time aggregator)

### 4a. Backend aggregator
Add `candidateService.getCandidateTimeline(user, candidateId)` (auth + read-scope as other reads). It loads the candidate doc (with `editHistory`, `statusHistory`, `assignmentEmails`, `createdAt`, `createdBy`, `resumeUnderstandingStatus`), the `candidateactivities`, and the related `taskBody` interviews, then maps each source into a common event shape and returns them merged + sorted newest-first:
```
{ id, ts, type, label, actor, detail, source }
```
Normalisation:
| Source | → event(s) |
|---|---|
| `createdAt` (+ `createdBy`) | `created` — "Candidate created" |
| `editHistory[]` `{field, oldValue, newValue, actor, ts}` | one event per entry: `field_changed` with a friendly label per field — `expert`→"Expert assigned/changed", `teamLead`→"Team Lead set", `recruiter`→"Recruiter changed", `visaType`/`company`/EAD→"… updated". Skip `status` (covered by statusHistory). |
| `statusHistory[]` `{from,to,changedAt,changedBy}` | `status_changed` — "Status: from → to" |
| `assignmentEmails[]` `{ts,to,cc,subject,sender,status}` | `assignment_email` — "Assignment email sent to <to>" (+ cc count) |
| `candidateactivities` `{type,outcome,notes,createdBy,createdAt}` | pass through (`call_attempt`/`document_prepared`/`mock_interview`/`task_created`/`task_recreated`) |
| `taskBody` interviews | `interview` — round/client/date |

Dedup rule: status appears in both `editHistory` (field `status`) and `statusHistory` — emit it **only** from `statusHistory` (canonical, has from/to). Each event gets a stable `id` (e.g. `source:index` or the activity `_id`) for React keys.

### 4b. Transport
Expose via `GET /api/candidates/:id/timeline` (controller `getCandidateTimeline`, thin; reuse the read gate) returning `{ success, timeline: [...] }`. (The Activity tab may keep its `getActivities` socket for live `newActivity` pushes; the unified timeline fetches the merged feed on open + refetches on `newActivity`.)

### 4c. Frontend — unified timeline in both surfaces
A shared `CandidateTimeline` component (e.g. `frontend/src/components/candidates/CandidateTimeline.tsx`) that fetches `/timeline`, renders each event with a per-type icon + label + relative/absolute timestamp + actor, newest-first. Mount it:
- **Candidate detail page** — replace the current 3-kind timeline section with `<CandidateTimeline candidateId=… />`.
- **Activity tab** (`CandidateActivityTab`) — render the unified feed (keep the existing "add activity" controls; the feed below becomes the merged timeline). Refetch on the `newActivity` socket event so manual entries appear live.

Icons/labels: extend the existing Activity-tab icon map with `status_changed`, `assignment_email`, `field_changed`/`expert_assigned`, `created`, `interview`.

## 5. Testing

**Backend (Jest):**
- `formatCandidateListRecord`: returns the lean field set; does **not** call `userModel.getAllUsers` (spy asserts 0 calls) for a list of N candidates; applies PRT visibility for a non-marketing role.
- `getCandidateTimeline`: merges all six sources into one sorted (newest-first) feed; status emitted from statusHistory not editHistory (no dupes); assignment-email + expert-assigned (editHistory `expert`) appear; empty sources → empty/created-only feed; auth/scope gate.
- `getCandidatesForUser` still returns correct counts/scoping (existing tests stay green).

**Frontend (Vitest):**
- `CandidateTimeline`: given a mocked `/timeline` payload with mixed event types, renders them newest-first with correct labels/icons; refetches on `newActivity`.
- BranchCandidates list still renders + searches with the lean payload (search matches name/email/technology/recruiter/expert).

**Manual:** load Branch Candidates (verify fast); search returns instantly; open a candidate → timeline shows created, expert assigned, assignment email sent, status changes, calls/docs/mocks, interviews — for an existing candidate (synthesised from stored data).

## 6. Out of scope
- Server-side pagination / virtualization (P1 §3d).
- New write-path activity logging (the aggregator derives everything from existing stores).
- SP3 (ISO-date filtering + sorting) — next, separate spec.

## 7. Risks / mitigations
- **Trimming the list payload breaks a frontend feature that read a now-missing field** → the §3c audit + route heavy needs through `GET /:id`. Land the lean-formatter (N+1 kill) first; trim projection only after the audit.
- **Timeline dedup** (status in editHistory + statusHistory) → emit status only from statusHistory.
- **Aggregator cost** → it runs for ONE candidate on detail open (not the list), reading already-projected arrays + one `candidateactivities` query + the existing interviews query; cheap.
- **`getAllUsers` cache freshness** unaffected (we just stop calling it per row).
