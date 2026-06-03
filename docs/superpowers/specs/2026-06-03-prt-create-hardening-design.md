# PRT create-flow hardening — mandatory fields, deep-link open, auto-send verify, email preview — design

> Date: 2026-06-03
> Status: approved (brainstorming) — pending implementation plan
> Area: Branch Candidates create flow + Assignment Email modal. Make the marketing create surface enforce its required fields server-side, open the form via a deep link, verify the existing auto-send, and give the manual button a true server-accurate preview.

## 1. Problem

The marketing create surface (`/branch-candidates`, socket `createCandidate`) has four gaps:

1. **Mandatory fields are not enforced server-side.** `validateCandidateCreate` (`backend/src/middleware/validation.js`) requires only `name`, `email`, `technology`, `recruiter`, `branch`, `resumeLink`. `contact` is optional, and the marketing fields — `visaType`, `company`, `experienceYears`, `city`, `state`, `eadStartDate`, `eadEndDate` — are **not in its allow-list at all**, so they are neither required nor passed through to `createCandidateFromManager` (they are silently stripped). The create form already requires them client-side, but the server does not — so creation is bypassable and the fields can be lost. (This is the root reason SP1 needed a "fill marketing info later" worklist/modal.)
2. **No quick path to the Add Candidate form.** It only opens via the in-page "Add Candidate" button; there is no deep link from the marketing nav.
3. **Auto-send on create exists but is unverified.** `handleCreateCandidate` already uploads the resume as a canonical attachment and POSTs `/send-assignment-email` with the Graph token (delegated/OBO, outbox fallback). It has no test and has not been verified end-to-end.
4. **The assignment-email modal preview is approximate.** It shows `To` and `CC` from client props (the recruiter's manager is only a placeholder string), and it does **not** render the actual email body — it only states "uses the §6.2 template".

## 2. Decisions (locked with user)

- **Auto-send:** send immediately on a successful create, **no confirmation step**, from the creator's mailbox (delegated/OBO; server falls back to the async outbox on failure). The manual button remains for resend + preview. *(Already implemented — this spec only verifies + tests it.)*
- **Mandatory set:** every create-form field except the optional **additional** attachment is required — `name`, `email`, `contact`, `technology`, `recruiter`, `experienceYears`, `visaType` (+ `eadStartDate`/`eadEndDate` when the visa carries an EAD card), `company`, `city`, `state`, and the resume. `teamLead` is **auto-derived** from the recruiter (not a form input); create is **blocked** if it cannot be derived.
- **Add-form open:** the "Move to Marketing" nav item (and a `?new=1` deep link) lands on Branch Candidates with the create dialog already open. Normal visits do **not** force it open.
- **Preview:** server-accurate. A new preview endpoint runs the *same* builder without sending and returns the exact `To`/`CC`/`BCC`/subject/body/attachment-filenames; the modal renders them, including the **rendered body**.

## 3. Architecture / data flow

No new collections or schema. The create path stays: frontend `socket.emit('createCandidate', payload)` → `candidateSocket.handleCreateCandidate` → `validateCandidateCreate` → `candidateService.createCandidateFromManager`. The post-create enrichment (resume attachment, additional files, auto-send, notes) stays in `handleCreateCandidate`. The preview reuses `assignmentEmailService.buildAssignmentEmail` and `candidateService`'s recipient-resolution logic, minus the S3 byte fetch and the send.

## 4. Design

### 4a. Mandatory fields — server (`[FIX]`)

**`backend/src/middleware/validation.js` → `validateCandidateCreate`** — extend to require and pass through the marketing fields. Import the enums from the model: `VISA_TYPE_VALUES`, `COMPANY_VALUES`, `EAD_REQUIRED_VISA_TYPES` (`backend/src/models/Candidate.js`).

- `contact`: required; non-empty string. (The service normalizes to `+1XXXXXXXXXX`; the validator only checks presence + that it is a string, to avoid duplicating the normalize logic.)
- `experienceYears`: required; integer 1–20 (accept number or numeric string → `payload.experienceYears = Number(...)`).
- `visaType`: required; must be in `VISA_TYPE_VALUES`.
- `company`: required; must be in `COMPANY_VALUES`.
- `city`, `state`: required; non-empty strings.
- `eadStartDate` + `eadEndDate`: required **iff** `visaType ∈ EAD_REQUIRED_VISA_TYPES`; when both present, `eadEndDate > eadStartDate`. When the visa does not require EAD, they are optional and passed through only if present.
- All added to `payload` so they reach the service.

**`backend/src/services/candidateService.js` → `createCandidateFromManager`** — server backstop for teamLead:
- After the existing teamLead derivation, if the derived team-lead email is empty → `throw` a 400 (`'Team Lead could not be derived from the recruiter — pick a recruiter with a team lead'`). This blocks orphan creates even if a client skips the check. Enum/range validation for the PRT fields already exists in the service and is unchanged.

The socket handler already returns `{ success:false, error:'Validation failed', details: validation.errors }` on invalid payloads — unchanged. The create form already surfaces `response.details` — unchanged.

### 4b. Deep-link open the Add Candidate form (`[NEW]`)

- **`frontend/src/components/layout/Sidebar.tsx`** — change the "Move to Marketing" item's `href` from `/branch-candidates` to `/branch-candidates?new=1`. (The plain "Branch Candidates" item stays `/branch-candidates`.)
- **`frontend/src/components/dashboard/BranchCandidates.tsx`** — on mount, read `useSearchParams()`; if `new === '1'`, `setIsCreateOpen(true)` and then `setSearchParams({}, { replace: true })` to strip the param so a refresh/back does not reopen the dialog. Guard with a `useRef` so it fires once. Normal visits (no param) are unaffected.

### 4c. Auto-send on create — verify (`[VERIFY]`)

No change to the happy path. Confirm + lock with tests:
- The send controller reads `x-graph-access-token` and passes it to `candidateService.sendAssignmentEmail` (verified in exploration). With a token → delegated send from the creator's mailbox; without → async outbox fallback. The create flow passes `attachmentIds: [resumeAttachmentId]` so the gate (recruiter + teamLead + ≥1 attachment) is satisfied by the just-uploaded resume.
- **Frontend test** (`BranchCandidates`): after a successful `createCandidate` callback, `handleCreateCandidate` POSTs to `/api/candidates/:id/attachments`, `/set-as-resume`, then `/send-assignment-email`. Assert the send call is made with the resume attachment id and that a failure surfaces the "Assignment email not sent" toast (non-blocking — the candidate is still created).
- Minor polish: keep the existing success ("Candidate created") + failure toasts; no behavior change.

### 4d. Assignment-email preview endpoint + modal (`[ENHANCE]`)

**Backend — shared builder split.** In `backend/src/services/assignmentEmailService.js`, `buildAssignmentEmail(args)` currently expects `attachments` carrying base64 bytes and returns the full Graph `message`. Refactor so the recipient/subject/body construction does **not** require bytes:
- Keep `buildAssignmentEmail` working for the send path (bytes included → full `message` with `attachments[]`).
- The recipient + subject + body + `_audit` construction already only needs attachment **filenames** (bytes are only attached to `message.attachments`). Ensure passing attachments as `[{ filename, mimeType }]` (no `contentBytesBase64`) yields a valid `message` minus the `attachments[]` array — i.e. byte-less attachments are simply omitted from `message.attachments` but still listed in the returned preview metadata. No separate body builder is needed; the preview just calls the same function with byte-less attachment descriptors and reads `_audit` (to/cc/bcc/subject/attachmentIds) + `message.body.content`.

**Backend — service method.** `candidateService.buildAssignmentEmailPreview(user, candidateId, options)`:
- Same auth + gate as `sendAssignmentEmail` (role in `PRT_ATTACHMENT_ROLES`, `_assertAttachmentPermission`, recruiter + teamLead + ≥1 attachment; 400 on any gate failure — identical messages).
- Resolve recruiter/teamLead/manager display names + emails + permanent CC exactly as the send path does.
- Call `buildAssignmentEmail` with attachment **metadata only** (`selected.map(a => ({ id, filename, mimeType }))`) — **no `storageService.fetchObjectAsBase64`** (preview must be cheap; no S3 reads).
- Return `{ to, cc, bcc, subject, bodyHtml, attachments: [{ id, filename }] }` (from `_audit` + `message.body.content`). Does **not** send, does **not** write `assignmentEmails[]`, does **not** flip `ackEmail`.

**Backend — controller + route.**
- `candidateController.previewAssignmentEmail(req, res)` — thin: read `options` from the body (`subject`, `appendBody`, `attachmentIds`), call the service, map service `statusCode` errors to responses (same shape as `sendAssignmentEmail`).
- Route: `POST /api/candidates/:id/assignment-email/preview` in `backend/src/routes/candidates.js`, same `requireHTTPRole` gate as the send route.

**Frontend — modal.** `frontend/src/components/candidates/AssignmentEmailModal.tsx`:
- On open (and on debounced change of `subject` / `appendBody` / `selectedAttachmentIds`), `authFetch` the preview endpoint with the current options.
- Render the returned **`to`**, **`cc`** (chips — includes the resolved manager + Tushar, no more placeholder), **`bcc`** if any, the **attachment filenames**, and the **`bodyHtml`** in a read-only, scrollable panel (sanitized; rendered via `dangerouslySetInnerHTML` after DOMPurify, matching the codebase's existing sanitized-HTML pattern).
- Keep the editable `subject` and "additional notes" (`appendBody`) inputs above the preview; the preview reflects them (debounced refetch). The Send button posts to the existing `/send-assignment-email` unchanged.
- Loading + error states: show a spinner while fetching; if the preview endpoint returns a gate 400, show that message in place of the preview (and disable Send) — this also makes the modal a reliable "why can't I send?" surface.

## 5. Testing

**Backend (Jest):**
- `validation` create tests: rejects when any of contact/experienceYears/visaType/company/city/state is missing; rejects invalid `visaType`/`company` enum; requires EAD dates when `visaType ∈ EAD_REQUIRED_VISA_TYPES` and enforces end > start; passes all fields through to `payload` on a valid input.
- `candidateService.createCandidateFromManager`: throws 400 when teamLead cannot be derived from the recruiter (mock the recruiter lookup to return no team lead).
- `candidateService.buildAssignmentEmailPreview`: returns to/cc/bcc/subject/bodyHtml/attachments without calling `storageService.fetchObjectAsBase64` and without writing the candidate; 400 on gate failures (no recruiter / no teamLead / no attachment); non-marketing role → 403.
- `candidateController.previewAssignmentEmail`: 200 happy path shape; maps service 400/403/404.

**Frontend (Vitest):**
- `BranchCandidates` deep-link: rendering with `?new=1` opens the create dialog and strips the param; without it the dialog stays closed.
- `BranchCandidates` auto-send: a successful create triggers the attachment upload + `/send-assignment-email` POST; a send failure shows the non-blocking toast and does not block "Candidate created".
- `AssignmentEmailModal`: on open it fetches the preview and renders To/CC/attachment filenames/body; a gate-400 response disables Send and shows the reason.

**Manual:** create a candidate with a missing field via a crafted socket payload → rejected with the field error; "Move to Marketing" opens the form; a normal create sends the email automatically; the button modal shows the exact recipients + body.

## 6. Out of scope

- The §6.2 template content (unchanged).
- The EmailOutbox/worker internals (unchanged; only reused as the auto-send fallback).
- Non-marketing create paths (none exist through the `createCandidate` socket — single emitter).
- SP3 (ISO-date filtering + sorting) — separate spec, next.

## 7. Risks / mitigations

- **Breaking an existing client by requiring fields:** the only `createCandidate` emitter is the Branch Candidates form, which already requires + sends these fields. No other client/path is affected.
- **Preview leaking PRT data to non-marketing roles:** the preview endpoint uses the identical gate as the send (`PRT_ATTACHMENT_ROLES` + `_assertAttachmentPermission`).
- **Preview body XSS:** the body is server-generated from a fixed template, but it is still sanitized (DOMPurify) before `dangerouslySetInnerHTML`, matching the repo's existing pattern.
- **Preview cost:** no S3 byte reads in the preview path; only metadata + template render.
