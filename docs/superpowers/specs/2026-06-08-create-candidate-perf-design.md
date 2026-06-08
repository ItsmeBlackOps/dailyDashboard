# Create-Candidate Perf Fix — Design

> Date: 2026-06-08. Scope: **frontend + backend**. Branch: `feat/create-candidate-perf`.

## Problem

Creating a candidate feels slow. After the user clicks **Submit**, the UI stays busy for several seconds before
the dialog releases.

## Root cause (verified via systematic-debugging Phase 1)

The slowness is a **serialized chain of ~6–8 network round-trips** the submit handler awaits before the UI settles
(`frontend/src/components/dashboard/BranchCandidates.tsx`, submit handler ~3255–3535):

1. Upload resume → storage (`POST /api/candidates/resume`).
2. `createCandidate` (socket).
3. Re-upload the **same** resume as an attachment + set-as-resume (2 round-trips — the PDF is uploaded **twice**).
4. Additional attachments (N sequential POSTs).
5. MSAL Graph-token acquisition + assignment-email POST.
6. Notes comment (socket).
7. **Full candidate-list refetch** (`fetchCandidates()` ~2765–2848 + full client-state rebuild) — blocks last.

Plus one backend hotspot inside step 2: the duplicate-email check
(`backend/src/models/Candidate.js:920` `getCandidateByEmail`) uses a **case-insensitive `$regex`**
(`{ 'Email ID': { $regex: /^…$/i }, sort: { _last_write: -1 } }`). A `/i` regex **cannot use** the existing
`{ 'Email ID': 1 }` index (`ensurePerfIndexes.js:32`), so it is an effective **collection scan on every create**,
growing with the candidate table.

**Ruled out (verified, not assumed):** no synchronous assignment-email Graph send on the backend create path;
notification-outbox enqueues are async (`eventBus.publish` is a plain synchronous `emitter.emit` that does not await
listeners); resume profile derivation is fire-and-forget via `setImmediate` (only the file upload blocks);
the `'Email ID'` field **is** indexed — the `/i` regex is what defeats it.

## Goal

Make submit **feel instant** and remove the per-create collection scan — **without changing what ultimately gets
created or sent** (same candidate record, same attachments, same auto-sent assignment email).

## Decisions (locked with user)

1. **Close the dialog the instant the candidate is created.** Everything after — attachments, assignment email,
   notes, list refresh — runs in the background; failures surface as toasts.
2. **Optimistic insert + background reconcile.** Prepend the returned candidate to the list immediately; a background
   refetch reconciles it against the active filter/sort.
3. **Assignment email keeps auto-sending** on create — preserved behavior, just moved off the critical path.
4. **Resume upload stays pre-create** (the create payload needs `resumeLink`).
5. **De-dupe the second resume upload if cheap.** Prefer reusing the already-uploaded `resumeLink` for the resume
   attachment over re-uploading the bytes — but ONLY if a backend path to register an existing storage object as an
   attachment already exists. If it doesn't, keep the current re-upload (now backgrounded, so it no longer affects the
   user) rather than adding new backend attachment-API surface. This is an optimization, not core to the goal.
6. **Backend:** collation-indexed exact-match duplicate check (no regex, no scan, no new field, no backfill).

## Frontend design (`BranchCandidates.tsx`)

**Critical path (awaited, gates the dialog) shrinks to 2 round-trips:**
- Validate (sync, unchanged) → upload resume (`resumeLink`) → `createCandidate` (socket).
- On the create success callback: `setCreating(false)`, **close the dialog**, show a success toast, and
  **optimistically prepend** the returned candidate to `candidates` state.

**Background enrichment (NOT awaited by the UI)** — extract a `enrichCandidateInBackground(candidateId, ctx)` helper
that runs after the dialog closes:
- Resume attachment: add the resume to the attachments list + set-as-resume, exactly as today (so the resume still
  appears in the Attachment Zone). Now backgrounded. If a backend path to register the already-uploaded `resumeLink`
  object exists, prefer it to skip re-uploading the PDF (decision #5); otherwise keep the existing re-upload.
- Additional attachments: upload `createAdditionalFiles` (may run with `Promise.allSettled`, not strictly sequential).
- Assignment email: acquire Graph token + `POST /api/candidates/:id/send-assignment-email` (unchanged call, now backgrounded).
- Notes: `addResumeComment` socket emit with `type='notes'` if notes present.
- Final **background** `fetchCandidates()` to reconcile the optimistic row (replaces the previously-blocking refetch).

**Error handling:** each background step is wrapped in try/catch and surfaces a specific, actionable toast
(e.g. "Assignment email couldn't be sent — resend from the candidate page"). The candidate already exists, so every
background failure is recoverable from the detail page. The optimistic row is corrected/dropped by the reconcile refetch.

**State:** `creating` gates only the critical path (validate → resume upload → create). Form state is reset on dialog
close; the background task captures what it needs (candidateId, resumeLink, additional files, notes, email intent) up front
so resetting the form does not race the background work.

## Backend design (`Candidate.js` + `ensurePerfIndexes.js`)

- **Index:** add a case-insensitive collation index in `ensurePerfIndexes.js`:
  `await db.collection('candidateDetails').createIndex({ 'Email ID': 1 }, { collation: { locale: 'en', strength: 2 }, name: 'emailId_ci' });`
  (Coexists with the existing plain `{ 'Email ID': 1 }` index; the plain one still serves other exact/regex queries.)
- **Query:** rewrite `getCandidateByEmail` (Candidate.js:920) to an exact match with collation:
  ```js
  const trimmedEmail = email.trim();
  const document = await this.collection.findOne(
    { 'Email ID': trimmedEmail, docType: { $in: [null, 'candidate'] } },
    { projection: DEFAULT_PROJECTION, sort: { _last_write: -1 }, collation: { locale: 'en', strength: 2 } }
  );
  ```
  Strength-2 collation makes the equality case-insensitive and **index-served** — no regex, no scan. Behavior is
  identical (still case-insensitive duplicate detection); only the mechanism changes.

## Testing

- **Backend (Jest):** `getCandidateByEmail` returns the candidate for a differing-case email (`JOHN@x.com` finds the
  `john@x.com` record); duplicate-creation remains blocked across case. (Needs the collation index; the test asserts the
  query returns the match — it does not assert the explain plan.)
- **Frontend (Vitest):** the submit handler closes the dialog and optimistically inserts the new candidate **immediately
  after** the create resolves, **without awaiting** enrichment (assert the dialog-closed/list-updated state is reached
  before the mocked attachment/email calls resolve); an enrichment failure shows a toast and does **not** reopen the
  dialog or throw.

## Out of scope

- Changing whether the assignment email auto-sends (it stays — decision #3).
- Reworking the candidate-list query itself (already optimized: LIST_PROJECTION, view-scoped, N+1 fix).
- The backend create path beyond the duplicate-check (insert/read-back/teamLead resolution are cheap; notifications are
  already async).

## Rollout

Standard PR + auto-deploy. Frontend and backend changes are independent and both backward-compatible (no contract change,
no data migration). The collation index build is a one-time online operation in `ensurePerfIndexes`.
