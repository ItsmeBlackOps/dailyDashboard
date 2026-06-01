# Add Candidate Form Updates + Move-to-Marketing — Design

> Date: 2026-06-01 · Status: approved (pending spec review) · Area: candidates / PRT marketing surface

## Context

Follow-up tweaks to the PRT **Add Candidate** flow (the dialog in
`frontend/src/components/dashboard/BranchCandidates.tsx`, backed by
`candidateService.createCandidateFromManager`) plus a new sidebar action to
move candidates into the Marketing team. Seven changes, scoped to the
marketing create surface; no rework of the existing role-based PRT
visibility model.

Two facts from exploration that shape the design:

1. **Candidates have no `team` field today.** Marketing-vs-technical is
   decided by the *requester's* role/team via `_applyPrtVisibility`, not a
   candidate attribute. "Move to Marketing" therefore introduces a
   candidate-level `team` attribute.
2. **Create requires `resumeLink`, but the Assignment Email attaches from
   `attachments[]`.** For the email to carry the resume, the uploaded
   resume must be persisted as an `attachments[]` entry (which also keeps
   `resumeLink` as the canonical pointer via set-as-resume).

## Decisions locked (with user)

1. **Submit sends the §6.2 Assignment Email**, auto-queued through the
   existing EmailOutbox/worker (Phase 3.5). To: Team Lead; CC: recruiter's
   manager + permanent CC. App-only sender (per the Phase 3.5 decision).
2. **"Move to Marketing"** is an action that sets the candidate's
   `team = 'marketing'`. Surfaced from the sidebar, driving a bulk action
   over the existing Branch Candidates multi-select.
3. **Mandatory fields = Core PRT set**: Name, Candidate Email, Technology,
   Recruiter, Team Lead, Experience, Visa Type, Company, **Resume**, and
   EAD Start/End when the visa type requires them. Contact / City / State
   stay optional.
4. **Sidebar item visibility** = Admin + Marketing Manager + Marketing
   Assistant Manager only, expressed as
   `['admin','mm','mam'].includes(toLegacyRole(role, team))` (excludes
   technical AM, team leads, recruiters, experts).

## Decisions locked (recommended defaults)

5. **Email orchestration = client-orchestrated post-create sequence**,
   reusing existing endpoints rather than new backend orchestration:
   create (socket) → upload resume as attachment (P2 HTTP) → enqueue
   assignment email (P3.5 HTTP) → save notes (candidatecomments). Steps
   after create are non-blocking: the candidate is always saved; a failed
   email/note surfaces a toast but does not roll back the create. Chosen
   over server-side orchestration because the create is socket-based, the
   resume upload is multipart HTTP, and attachments need the post-create
   `candidateId` — client sequencing reuses P2/P3.5 verbatim with zero new
   server coupling.
6. **Technology "+ Add new"** submits a free-text value; the backend
   already accepts unknown technologies with a 60-day `logger.warn`. The
   new value is **not** persisted to the enum list (YAGNI).
7. **Team Lead** becomes read-only, auto-filled from the selected
   recruiter's team lead. Server `buildCandidateOptions` recruiter choices
   are extended to carry each recruiter's `teamLead` display name so the
   form fills it on recruiter-select; the server still derives/validates on
   create as the source of truth.
8. **Notes** reuse `candidatecomments` with `type='notes'` (consistent with
   the PRT plan), authored by the submitter, saved after create.

## Changes by area

### Frontend — `BranchCandidates.tsx` Add Candidate dialog

- **Label**: `Email` → **"Candidate Email"** (state key `email` unchanged).
- **Validation**: required = Name, Candidate Email (valid email),
  Technology, Recruiter, Team Lead (auto), Experience, Visa Type, Company,
  Resume; EAD Start/End required iff `visaType ∈ PRT_EAD_REQUIRED_VISA_TYPES`
  and End > Start. Block submit, mark invalid fields, toast a summary.
- **Technology**: add an `"+ Add new technology…"` item to the existing
  Select. Selecting it swaps in a free-text `Input`; its trimmed value is
  submitted as `technology`. A "back to list" affordance restores the
  dropdown.
- **Team Lead**: replace the editable `Input` with a read-only field
  (disabled input / static text) bound to the selected recruiter's team
  lead; shows "—" until a recruiter is chosen. No longer user-editable.
- **Notes**: optional `Textarea` with a 2000-char counter, below the PRT
  fields.
- **Submit (`handleCreateCandidate`)** becomes the post-create sequence in
  Decision 5. Order: validate → `createCandidate` (socket) → on success,
  with the returned `candidateId`: (a) upload the resume via the P2
  attachment endpoint (which also set-as-resume to preserve `resumeLink`),
  (b) `POST /api/candidates/:id/send-assignment-email` to enqueue, (c) save
  the note to `candidatecomments`. Each post-step is try/caught with its
  own toast; none blocks the others or the create.

### Frontend — `Sidebar.tsx`

- New role-gated `NavItem` **"Move to Marketing"** (gate from Decision 4)
  that navigates to `/branch-candidates`.
- On Branch Candidates, the existing multi-select toolbar gains a **"Move to
  Marketing"** bulk-action button, shown under the same gate (Decision 4).
  No separate "mode" — the sidebar item is a shortcut to the list where the
  bulk action lives. The button is enabled when ≥1 candidate is selected.

### Backend — candidate `team` attribute + move action

- **Model**: add `team` to `candidateDetails` (`technical|marketing|sales|
  null`, default `null`). Add `'team'` to `CANDIDATE_AUDITED`.
- **Service**: `candidateService.moveCandidatesToMarketing(user, ids)` —
  gate `toLegacyRole(user.role, user.team) ∈ {admin, mm, mam}`; scope-check
  each candidate via the existing recruiter-scope walk; set
  `team = 'marketing'`; push `editHistory`. Returns per-id success/failure.
- **Transport**: a socket event (e.g. `moveCandidatesToMarketing`) or
  `POST /api/candidates/move-to-marketing` (plan picks one, mirroring the
  existing bulk-status pattern).

### Backend — recruiter options carry teamLead

- Extend `buildCandidateOptions` recruiter choices with each recruiter's
  `teamLead` display name, so the form can auto-fill Team Lead client-side.

### Backend — assignment email on create

- No new code: the create-time email reuses the existing
  `sendAssignmentEmail` enqueue path (P3.5). The only enabling change is
  ensuring the create resume becomes an `attachments[]` entry (handled
  client-side in the post-create sequence via the P2 endpoint).

## Permissions

| Action | Allowed |
|---|---|
| Add Candidate (create) | existing gate: admin, mm, mam (+ C20 equivalents) |
| Auto-queue assignment email on create | same as create (reuses send gate) |
| "Move to Marketing" sidebar item + bulk action | admin + marketing manager + marketing AM only — `toLegacyRole(role,team) ∈ {admin,mm,mam}` |

## Out of scope (explicit)

- **No rewiring of role-based PRT visibility** to filter on candidate
  `team`. The new `team` attribute is set + audited; making the marketing
  surface filter/scope by it is a separate, larger change.
- Technology enum is not expanded/persisted from the "+ Add new" path.
- No candidate-facing confirmation email.
- The other ~10 raw-role gates in `candidateService.js` remain deferred to
  C20 phase 2 (unchanged here).

## Acceptance criteria

- Submitting Add Candidate with all mandatory fields + a resume creates the
  candidate, the resume appears as an attachment, an assignment-email outbox
  row is enqueued (To: team lead, CC: manager + permanent CC), and any note
  is saved as a `type='notes'` comment.
- Missing a mandatory field blocks submit with a clear inline error; the
  email is never queued for an incomplete submit.
- "Candidate Email" label renders; the field validates as an email.
- Technology "+ Add new" lets a user submit a custom technology; it persists
  on the candidate (with the backend 60-day warning) and is not added to the
  enum dropdown.
- Team Lead is read-only and reflects the selected recruiter's team lead;
  changing the recruiter updates it; it cannot be hand-edited.
- The "Move to Marketing" sidebar item is visible only to admin / marketing
  manager / marketing AM; using its bulk action sets `team='marketing'` on
  the selected candidates and writes an `editHistory` entry; out-of-scope
  candidates are rejected.

## Testing

- **Backend (Jest)**: `moveCandidatesToMarketing` gate (allowed vs technical
  AM / mlead / recruiter rejected), scope check, `team` set + `editHistory`
  pushed; `buildCandidateOptions` includes recruiter teamLead;
  `CANDIDATE_AUDITED` includes `team`.
- **Frontend (Vitest)**: mandatory-field validation blocks submit;
  Candidate Email label + email validation; Technology "+ Add new" toggles
  free-text and submits it; Team Lead read-only auto-fills from recruiter;
  post-create sequence calls attachment → send-email → notes in order with
  non-blocking error handling; sidebar item visibility per role/team.
- **Manual**: end-to-end create with a sandbox mailbox confirms the queued
  assignment email carries the resume; "Move to Marketing" flips team on a
  scoped candidate and is hidden for a recruiter.
