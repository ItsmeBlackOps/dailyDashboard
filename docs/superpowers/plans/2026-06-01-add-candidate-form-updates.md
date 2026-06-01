# Add Candidate Form Updates + Move-to-Marketing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) tracking.

**Goal:** Update the PRT Add Candidate form (label, mandatory fields, technology add-new, read-only auto-filled team lead, multi-attachment box, notes, auto-queued assignment email on submit) and add a role-gated "Move to Marketing" bulk action.

**Architecture:** Frontend form changes in `BranchCandidates.tsx` + a post-create orchestration sequence reusing existing P2 (attachments) / P3.5 (assignment email) / addComment endpoints. Backend adds a candidate `team` attribute, `moveCandidatesToMarketing`, recruiter-options teamLead, and an any-format "additional attachments" upload path.

**Tech Stack:** Express 5 (ESM) + Mongo, React 18 + TS + Vite + shadcn/ui, Socket.IO, Jest, Vitest.

**Key integration points (verified):**
- Create: `socket.emit('createCandidate', payload)` in `handleCreateCandidate` (`BranchCandidates.tsx:3077`). Resume pre-upload → `POST /api/candidates/resume` → `resumeLink`.
- Attachment upload: `POST /api/candidates/:id/attachments` (FormData field `file`); set-as-resume: `.../attachments/:id/set-as-resume`. MIME whitelist + 10MB at `routes/candidates.js:31` (`ATTACHMENT_ALLOWED_MIMES`, multer fileFilter ~:44).
- Assignment email: `POST /api/candidates/:id/send-assignment-email` body `{ attachmentIds, subject?, appendBody? }` (`AssignmentEmailModal.tsx:105`).
- Notes: `candidateService.addComment(user, candidateId, content, type)` via socket `addComment` (`candidateSocket.js:863`). Use `type='notes'`.
- Recruiter options: `buildCandidateOptions` → `recruiterChoices: this.buildAssignablePeople(user)` (`candidateService.js:277`).
- Candidate write: `candidateModel.updateCandidateById` $set allow-list; `CANDIDATE_AUDITED` in `Candidate.js`.
- Bulk toolbar pattern: existing multi-select `bulkStatus` Select + `handleBulkStatusUpdate` in `BranchCandidates.tsx`.

---

## Backend

### Task B1: Candidate `team` attribute
**Files:** Modify `backend/src/models/Candidate.js`, `backend/src/services/candidateService.js`
- [ ] Add `team` to `CANDIDATE_AUDITED` array in `Candidate.js`.
- [ ] In `updateCandidateById`, include `team` in the PRT `$set` allow-list (alongside `visaType`, `company`, …) so `{ team }` persists.
- [ ] Add `'team'` to `DEFAULT_PROJECTION` in `Candidate.js` and to the PRT fields surfaced by `formatCandidateRecord` (so the UI can read it).
- [ ] Tests: extend `candidateModel`/prt tests to assert `team` is settable + audited.

### Task B2: `moveCandidatesToMarketing` service + socket
**Files:** Modify `backend/src/services/candidateService.js`, `backend/src/sockets/candidateSocket.js`; Test `backend/test/candidateService.moveToMarketing.test.js`
- [ ] **Failing test first** — gate (admin/mm/mam allowed; technical `am`, `mlead`, `recruiter` rejected), per-id scope check, sets `team='marketing'`, pushes editHistory.
- [ ] Implement `async moveCandidatesToMarketing(user, candidateIds)`:
  - gate: `if (!['admin','mm','mam'].includes(toLegacyRole(user.role, user.team))) throw 403`.
  - for each id: load candidate, `assertRecruiterInScope`/scope walk; `updateCandidateById(id, { team: 'marketing', _changedBy: user.email, _source: 'move-to-marketing', _pushEditHistory: {...} })`.
  - return `{ moved: [...], failed: [{id, error}] }`.
- [ ] Socket handler `moveCandidatesToMarketing` in `candidateSocket.js` (mirror `bulkUpdateCandidateStatus`): validate, call service, callback `{ success, moved, failed }`.
- [ ] Run tests → green. Commit.

### Task B3: Recruiter options carry teamLead
**Files:** Modify `backend/src/services/candidateService.js` (`buildAssignablePeople`); Test extend an existing options test
- [ ] In the recruiter-choice mapping, include each person's `teamLead` display name (resolve from the user record) on the option object: `{ value, label, teamLead }`.
- [ ] Test: `buildCandidateOptions(...).recruiterChoices[0]` has a `teamLead` field.
- [ ] Commit.

### Task B4: Any-format "additional" attachment upload
**Files:** Modify `backend/src/routes/candidates.js`
- [ ] Add a second multer instance `additionalUpload` = same storage + `attachmentMaxBytes` limit but **no `fileFilter`** (any MIME).
- [ ] Route `POST /api/candidates/:id/attachments/additional` using `additionalUpload.single('file')` → same controller as the normal attachment upload (stores in `attachments[]`).
- [ ] Test (`candidateController.attachments` or routes test): a `.zip`/arbitrary MIME is accepted on `/additional` but still rejected on the normal `/attachments` path; 10MB cap still enforced on both.
- [ ] Commit.

---

## Frontend — `BranchCandidates.tsx`

### Task F1: "Candidate Email" label
- [ ] Change the create dialog `<Label htmlFor="create-email">Email</Label>` → `Candidate Email`. (state key `email` unchanged.) Commit with F2/F3.

### Task F2: Technology "+ Add new"
- [ ] Add state `const [techCustom, setTechCustom] = useState(false)`.
- [ ] In the Technology `Select`, append `<SelectItem value="__add_new__">+ Add new technology…</SelectItem>`. In `onValueChange`: if `'__add_new__'` → `setTechCustom(true)` + clear technology; else set technology + `setTechCustom(false)`.
- [ ] When `techCustom`, render an `<Input>` bound to `createForm.technology` with a small "Choose from list" button that sets `techCustom=false`.
- [ ] Validation already requires non-empty `technology`; free-text passes (server warns on unknown).

### Task F3: Team Lead read-only auto-fill + required
- [ ] Extend the recruiter option type to include `teamLead?: string` (from B3); store it in `recruiterOptions`.
- [ ] On recruiter `onValueChange`, set `createForm.teamLead` to the chosen option's `teamLead` (display name) and keep it.
- [ ] Replace the Team Lead `<Input>` with a **read-only** input (`readOnly`, `disabled`-styled) showing `createForm.teamLead || '—'`; label "Team Lead (auto)".
- [ ] Add validation: `if (!trimmedTeamLead) → setCreateError('Selected recruiter has no team lead set')`.

### Task F4: Multi-attachment box
- [ ] Keep `createResumeFile` as the **fixed required Resume** slot (existing upload UI; relabel "Resume (required)"); accept `.pdf,.doc,.docx`.
- [ ] Add state `const [additionalFiles, setAdditionalFiles] = useState<File[]>([])`; a multi-file `<input type="file" multiple>` ("Additional attachments (optional, any format)") with a list + remove-per-file. No client MIME restriction; cap each at 10MB (toast if over).

### Task F5: Notes textarea
- [ ] Add state `const [createNotes, setCreateNotes] = useState('')`; a `<Textarea maxLength={2000}>` with a counter, below PRT fields.

### Task F6: Post-create orchestration
**Files:** `BranchCandidates.tsx` (`handleCreateCandidate` success callback)
- [ ] After `createCandidate` success, read `candidateId` from the response (verify the create callback returns the new id; if not, extend the socket create response to include it — see Task B-note).
- [ ] Sequentially, each in its own try/catch with a toast on failure (non-blocking):
  1. Upload `createResumeFile` → `POST /api/candidates/:id/attachments` → then `set-as-resume` on the returned attachment id.
  2. For each `additionalFiles[]` → `POST /api/candidates/:id/attachments/additional`.
  3. `POST /api/candidates/:id/send-assignment-email` with `{ attachmentIds: [resumeAttachmentId] }`.
  4. If `createNotes.trim()` → `socket.emit('addComment', { candidateId, content: createNotes.trim(), type: 'notes' })`.
- [ ] Final success toast: "Candidate created; assignment email queued." Reset form (incl. new state) + `fetchCandidates()`.

> **B-note (create returns id):** Confirm `createCandidate` socket callback includes the new candidate id. If it returns the formatted candidate, use `response.candidate.id`/`_id`. If absent, modify the socket `createCandidate` handler to return `{ success, candidate }` including the id.

### Task F7: Move to Marketing (sidebar + bulk action)
**Files:** `frontend/src/components/layout/Sidebar.tsx`, `BranchCandidates.tsx`
- [ ] Sidebar: add a `NavItem` "Move to Marketing" (icon e.g. `ArrowRightLeft`) → `href="/branch-candidates"`, gated by `['admin','mm','mam','manager','assistantmanager'].includes(normalizedRole)` **and** marketing team for the new-role names. Simplest correct gate available client-side: reuse the role+team check the app already uses (`toLegacyRole`-equiv). If the sidebar only has `normalizedRole`, gate on `['admin','mm','mam'].includes(normalizedRole) || (['manager'].includes(normalizedRole)) || (normalizedRole==='assistantmanager' && team==='marketing')`. Use the user profile's `team` from context.
- [ ] BranchCandidates: in the existing multi-select toolbar (where `bulkStatus` lives), add a **"Move to Marketing"** button shown under the same gate, enabled when `selectedIds.size > 0`.
- [ ] Handler `handleMoveToMarketing`: `socket.emit('moveCandidatesToMarketing', { candidateIds: [...selectedIds] }, cb)`; on success toast "Moved N to Marketing", clear selection, `fetchCandidates()`.

---

## Tests

### Task T1: Backend Jest
- [ ] `candidateService.moveToMarketing.test.js` (B2): allowed roles move + set team + editHistory; technical AM / mlead / recruiter → 403; out-of-scope candidate → failed entry.
- [ ] Recruiter-options teamLead (B3); `team` settable+audited (B1); additional-MIME accept vs whitelist reject (B4).

### Task T2: Frontend Vitest
- [ ] Add-candidate validation: missing team lead / visa / company / resume blocks submit; "Candidate Email" label present.
- [ ] Technology "+ Add new" toggles free-text and submits custom value.
- [ ] Team Lead read-only, auto-fills on recruiter select.
- [ ] Move-to-Marketing button hidden for recruiter, visible for mm; calls socket with selected ids.

### Task T3: Verify + ship
- [ ] Backend: `NODE_OPTIONS=--experimental-vm-modules npx jest` (new + related green; pre-existing ECONNREFUSED suites excepted).
- [ ] Frontend: `npx vitest run` green; `npx tsc --noEmit` clean.
- [ ] PR → CI green → merge to main (squash, delete branch).

## Out of scope
- No rewiring of role-based PRT visibility to filter on candidate `team`.
- Technology enum not expanded/persisted.
- No candidate-facing email.
