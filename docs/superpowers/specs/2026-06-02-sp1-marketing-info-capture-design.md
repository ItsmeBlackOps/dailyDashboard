# SP1 — Marketing-info capture (Visa / EAD / Company) — design

> Date: 2026-06-02
> Status: approved (brainstorming) — pending implementation plan
> Area: PRT candidate create flow + a marketing "needs info" worklist
> Related: PR #156 (recruiter→teamLead derivation) is independent of SP1 but
> should be merged so the `teamLead` shown on records stays correct. SP1 itself
> does not depend on it (the create flow already derives teamLead inline at
> `candidateService.js:~2409`, and the worklist routing reuses `collectHierarchyEmails`).
>
> Grounding (verified against `backend/src/services/candidateService.js`):
> - `createCandidateFromManager` (line ~2341) already hard-requires `resumeLink`,
>   `branch`, `recruiter`, `name`, `email`, and `teamLead` (derived from recruiter).
> - `sanitizeCandidatePayload` (line ~1460) already **validates** `visaType`/
>   `company`/`experienceYears` enums and **enforces the conditional-EAD rule**
>   (`eadRequiredByVisa`, line ~1522) — but only as `if (payload.X !== undefined)`
>   guards, so absent fields pass through unvalidated. The gap is *requiredness*.
> - `getResumeUnderstandingQueue`/`getResumeUnderstandingCount` (lines ~1180/~1279)
>   + `_resolveResumeRecruiterScope` (line ~1153) are the role-scoped-worklist
>   precedent to mirror. That scope already includes `self` and walks the hierarchy.
> - `formatCandidateRecord` (line ~812) already maps visa/EAD/company/experience.
> - `CANDIDATE_AUDITED` + `editHistory` push already exist (P1) — audited fields
>   include role/visa/company/EAD/etc. (partial CRUD-audit coverage; see SP6).

## 1. Problem

PRT marketing candidates need **Visa Type**, **EAD start/end** (for EAD-card visa types), and **Company** (SST/VCS/FED). All **1,412** existing candidates have these empty, and the assignment-email subject + downstream marketing depend on them.

The person who assigns a candidate to an **expert** is **Admin or a Technical Assistant Manager**, who do **not** hold this marketing data — so enforcing it at assign-time is wrong. Collection must happen:
1. **At candidate creation** (by the marketing person who creates it), and
2. For the **existing backlog**, via a **marketing-team worklist** that flags each candidate as pending/required and routes it to the right person.

There is **no gate on assign-to-expert** — the technical side is never blocked.

## 2. Decisions (locked with user)

- **Create is all-or-nothing:** in the Add-Candidate flow, **every field is hard-required except "additional attachments."** That includes Visa Type, Company, Experience Years, city/state, the core fields (name/email/contact/technology/branch/recruiter), and a **resume attachment**. EAD start/end are required **iff** `visaType ∈ EAD_REQUIRED_VISA_TYPES` (OPT, STEM OPT, CPT, Day 1 CPT, H4-EAD, L2). `teamLead` is **auto-derived** from the recruiter (PR #156), not typed.
- **No assign-to-expert gate.**
- **"Needs marketing info"** (for the existing backlog) = `visaType` empty **OR** `company` empty **OR** (EAD-card visa **AND** EAD start/end empty). Resume is **not** part of this flag (resume backfill is out of scope).
- Existing pending candidates surface in the **marketing team's view**: a dedicated **worklist page** + an **inline badge/filter** on Branch Candidates + a **count** indicator.
- **Worklist scope must include the direct-recruiter case for every role** (a manager/AM/team-lead who is themselves the recruiter on a candidate sees it), plus inactive-recruiter routing.

## 3. Architecture

### 3a. Create-time enforcement (Part 1)

The sanitizer already *validates* these fields and already *enforces* the conditional-EAD rule; the only gap is **requiredness**. So Part 1 is small and additive.

- **Backend** (`createCandidateFromManager`, after the existing `sanitizeCandidatePayload` call + the existing `resumeLink`/`branch`/`recruiter`/`name`/`email`/`teamLead` guards): add `if (!sanitized.X) → 400` guards for **`visaType`, `company`, `experienceYears`, `city`, `state`**, each naming the specific field. Because the sanitizer's `eadRequiredByVisa` branch already throws when an EAD-card `visaType` is set without valid EAD dates, **EAD start/end become required automatically** once `visaType` is required — no extra create-flow code for EAD. `resumeLink` is already required (no change). Mirrors the surrounding guard style exactly.
- **Frontend** (Add-Candidate form — the 9 PRT fields already exist from P1g): mark them required in client validation, keep EAD shown/required only for EAD-card visas (already wired), keep **additional attachments optional**. Submit blocked with inline per-field messages until complete.

### 3b. "Needs info" flag + helpers

- `candidateService.missingMarketingFields(candidate) → string[]` and `candidateNeedsMarketingInfo(candidate) → boolean` (pure; one source of truth).
- `formatCandidateRecord` adds `needsMarketingInfo: boolean` and `missingMarketingFields: string[]` to the candidate record (cheap; no extra I/O).

### 3c. Marketing worklist (Part 2)

- `candidateService.getMarketingInfoWorklist(user)` + `getMarketingInfoCount(user)` — **mirror `getResumeUnderstandingQueue`/`getResumeUnderstandingCount`** in structure (same role-normalization, same return shape, count-in-response). The only differences: the filter is `candidateNeedsMarketingInfo` (visa/company/conditional-EAD) instead of `resumeUnderstandingStatus`, and the scope is a **sibling of `_resolveResumeRecruiterScope`**.
- **Scope** (reusing `_resolveResumeRecruiterScope`'s shape — it already does what the user asked):
  - **recruiter:** `[self]`.
  - **team lead (mlead):** `hierarchy.recruiterEmails ∪ self` — `collectHierarchyEmails` BFS already includes **inactive** recruiters under the lead, so inactive-recruiter candidates route here automatically.
  - **assistant manager (mam):** `hierarchy.recruiterEmails ∪ allSubordinateEmails ∪ self`.
  - **manager (mm) / admin:** all in-scope (no recruiter filter), which inherently includes any candidate where they are themselves the recruiter.
  - `self` is in every non-admin set → **the direct-recruiter case is covered for every role** ("must not make mistakes"). Non-marketing (technical/expert) roles → empty worklist.
- `candidateController.getMarketingInfoWorklist` + route `GET /api/candidates/marketing-info-worklist` (mirror the resume-understanding queue route + gate).
- Filling values reuses the existing `updateCandidate` PRT-write path (visaType/eadStartDate/eadEndDate/company already supported by the sanitizer + write gate; the edit is audited via the existing `editHistory`).

### 3d. Frontend surfaces

- **`MarketingInfoModal.tsx`** — Visa Type dropdown, conditional EAD start/end, Company dropdown. Used by the **worklist** to fill an existing candidate (PATCH → refresh). (The create form keeps its own inline fields; the modal is the focused filler for the backlog.)
- **Worklist page** "Marketing Info Needed" + a nav entry (marketing roles only) + a pending **count** badge.
- **Branch Candidates**: a "Needs info" **badge** on flagged rows + a **filter** to show only those.

## 4. Data flow

Create → server validates all required fields → candidate stored complete → never appears in the worklist.
Existing candidate missing info → `needsMarketingInfo=true` on read → shows in the owner's worklist + badge → owner opens `MarketingInfoModal` → PATCH fills fields → `needsMarketingInfo=false` → drops off the worklist.

## 5. Error handling

- Create: 400 with the explicit list of missing required fields (frontend maps to per-field messages).
- Worklist fill: standard `updateCandidate` validation (enum checks, EAD-conditional) with field-level errors.
- Non-marketing viewer hitting the worklist endpoint: empty list (not an error).

## 6. Testing

- **Backend:** `missingMarketingFields`/`candidateNeedsMarketingInfo` (every branch incl. EAD-conditional); `createCandidateFromManager` rejects each missing required field and accepts when complete (additional attachments omitted is OK); `getMarketingInfoWorklist` scoping — recruiter sees own; team lead sees own-as-recruiter **and** inactive-recruiter routing; manager/admin see direct + hierarchy; non-marketing → empty.
- **Frontend:** `tsc`; create-form required validation (incl. conditional EAD, additional-attachments optional); `MarketingInfoModal` conditional-EAD behavior + save→refresh.

## 7. Out of scope

- **SP6** (CRUD audit logging) and **SP7** (Nikita read-only view) — separate sub-projects.
- Resume backfill for existing candidates (the worklist is about visa/EAD/company only).
- Any change to the assign-to-expert flow beyond *not* gating it.
