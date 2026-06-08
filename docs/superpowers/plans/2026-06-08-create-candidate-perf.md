# Create-Candidate Perf Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make create-candidate feel instant (dialog closes the moment the candidate is created; attachments/email/notes/list-refresh move to the background) and remove the per-create collection scan in the duplicate-email check.

**Architecture:** Backend — replace the index-defeating case-insensitive `$regex` duplicate check with a collation-indexed exact match. Frontend — in `BranchCandidates.tsx`, the create-callback releases the user immediately (close dialog + optimistic row + toast) and fires a non-awaited `enrichCandidateInBackground()` for the rest. The two parts are independent; do backend first.

**Tech Stack:** Node ESM + raw `mongodb` driver + Jest (`--experimental-vm-modules`); React + TypeScript + Vitest. Spec: `docs/superpowers/specs/2026-06-08-create-candidate-perf-design.md`.

**Windows test note:** run backend Jest via `cd backend && NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules npx jest <path>` (the `npm test` script breaks on bash-style inline env vars on Windows). Frontend: `cd frontend && npx vitest run <path>`. A claude-mem hook may truncate the Read tool to line 1 — if so, use Grep (`-n`, content mode) to read; Edit still works.

---

## File Structure

- `backend/src/models/Candidate.js` (modify `getCandidateByEmail`, ~line 920) — collation exact-match instead of `$regex`.
- `backend/src/jobs/ensurePerfIndexes.js` (modify, ~line 32) — add the case-insensitive collation index.
- `backend/test/candidateModel.getCandidateByEmail.test.js` (create) — assert the query is an index-friendly collation exact-match (no `$regex`).
- `frontend/src/components/dashboard/BranchCandidates.tsx` (modify) — extract `normalizeCandidateRow`; restructure the create-callback; add `enrichCandidateInBackground`.
- `frontend/src/components/dashboard/__tests__/normalizeCandidateRow.test.ts` (create) — pure-helper test (proves the optimistic row matches the list-row shape).

---

## Part A — Backend: collation-indexed duplicate check (do first; independent)

### Task A1: Replace the regex duplicate check with a collation exact-match + index

**Files:**
- Create: `backend/test/candidateModel.getCandidateByEmail.test.js`
- Modify: `backend/src/models/Candidate.js` (`getCandidateByEmail`, ~lines 920–938)
- Modify: `backend/src/jobs/ensurePerfIndexes.js` (after line 32)

- [ ] **Step 1: Write the failing test** — create `backend/test/candidateModel.getCandidateByEmail.test.js`:

```js
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { candidateModel } from '../src/models/Candidate.js';

const origCollection = candidateModel.collection;
afterEach(() => { candidateModel.collection = origCollection; });

describe('getCandidateByEmail — index-friendly collation lookup', () => {
  it('queries an exact match with a case-insensitive collation (no $regex)', async () => {
    const findOne = jest.fn().mockResolvedValue({ 'Email ID': 'john@x.com', 'Candidate Name': 'John' });
    candidateModel.collection = { findOne };

    await candidateModel.getCandidateByEmail('JOHN@x.com');

    expect(findOne).toHaveBeenCalledTimes(1);
    const [filter, options] = findOne.mock.calls[0];
    // exact match on the email, never a regex (a /i regex defeats the index)
    expect(filter['Email ID']).toBe('JOHN@x.com');
    expect(JSON.stringify(filter)).not.toContain('$regex');
    expect(filter.docType).toEqual({ $in: [null, 'candidate'] });
    // case-insensitivity comes from the collation, which lets the index serve it
    expect(options.collation).toEqual({ locale: 'en', strength: 2 });
  });

  it('returns null without querying when email is empty', async () => {
    const findOne = jest.fn();
    candidateModel.collection = { findOne };
    const result = await candidateModel.getCandidateByEmail('');
    expect(result).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `cd backend && NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules npx jest test/candidateModel.getCandidateByEmail.test.js`
Expected: FAIL — the first test fails because the current query uses `{ 'Email ID': { $regex: … } }` (so `filter['Email ID']` is an object, not the string, and `$regex` is present).

- [ ] **Step 3: Rewrite `getCandidateByEmail`** in `backend/src/models/Candidate.js`. Replace the current body (the `normalizedEmail` regex `findOne`) with an exact match + collation. The full method becomes:

```js
  async getCandidateByEmail(email) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!email) {
      return null;
    }

    // C-perf: exact match + case-insensitive collation. A case-insensitive
    // $regex cannot use the { 'Email ID': 1 } index and scans the whole
    // collection on every create; the collation lets the (collation) index
    // serve a case-insensitive equality directly. Behaviour is unchanged —
    // still case-insensitive duplicate detection.
    const trimmedEmail = email.trim();
    const document = await this.collection.findOne({
      'Email ID': trimmedEmail,
      docType: { $in: [null, 'candidate'] }
    }, {
      projection: DEFAULT_PROJECTION,
      sort: { _last_write: -1 },
      collation: { locale: 'en', strength: 2 }
    });

    return document ? this.mapDocumentToCandidate(document) : null;
  }
```

- [ ] **Step 4: Add the collation index** in `backend/src/jobs/ensurePerfIndexes.js`, immediately after the existing `await db.collection('candidateDetails').createIndex({ 'Email ID': 1 });` line (~line 32):

```js
    // C-perf: case-insensitive collation index so getCandidateByEmail's
    // duplicate check is an index-served equality (not a /i-regex collection
    // scan). Distinct name — coexists with the simple { 'Email ID': 1 } index.
    await db.collection('candidateDetails').createIndex(
      { 'Email ID': 1 },
      { collation: { locale: 'en', strength: 2 }, name: 'emailId_ci' }
    );
```

- [ ] **Step 5: Run the test, verify it PASSES**

Run: `cd backend && NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules npx jest test/candidateModel.getCandidateByEmail.test.js`
Expected: PASS (2 tests). Also run `node --check backend/src/models/Candidate.js && node --check backend/src/jobs/ensurePerfIndexes.js` → both OK.

- [ ] **Step 6: Commit**

```bash
git add backend/src/models/Candidate.js backend/src/jobs/ensurePerfIndexes.js backend/test/candidateModel.getCandidateByEmail.test.js
git commit -m "perf(candidates): index-served collation duplicate-email check (no /i-regex scan)"
```

---

## Part B — Frontend: instant submit + background enrichment

### Task B1: Extract `normalizeCandidateRow` and reuse it in `fetchCandidates`

**Files:**
- Modify: `frontend/src/components/dashboard/BranchCandidates.tsx` (the inline map at ~2802–2812)
- Create: `frontend/src/components/dashboard/__tests__/normalizeCandidateRow.test.ts`

This extraction is what makes the optimistic insert (Task B2) safe: the optimistic row uses the *same* normalization the list uses, so an inserted row is shape-identical to a fetched one.

- [ ] **Step 1: Write the failing test** — create `frontend/src/components/dashboard/__tests__/normalizeCandidateRow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeCandidateRow } from '../normalizeCandidateRow';

describe('normalizeCandidateRow', () => {
  it('fills the row defaults the list relies on', () => {
    const row = normalizeCandidateRow({ id: 'c1', 'name': 'Jane' } as any);
    expect(row).toMatchObject({
      id: 'c1',
      recruiter: '',
      recruiterRaw: '',
      expert: '',
      expertRaw: '',
      resumeLink: '',
      resumeUnderstanding: false,
    });
  });

  it('preserves provided values and coerces resumeUnderstanding to boolean', () => {
    const row = normalizeCandidateRow({
      id: 'c2', recruiter: 'Rec', recruiterRaw: 'rec@x.com', resumeLink: 'http://x/r.pdf',
      resumeUnderstanding: 1, resumeUnderstandingStatus: 'done', workflowStatus: 'awaiting',
    } as any);
    expect(row.recruiter).toBe('Rec');
    expect(row.resumeLink).toBe('http://x/r.pdf');
    expect(row.resumeUnderstanding).toBe(true);
    expect(row.resumeUnderstandingStatus).toBe('done');
    expect(row.workflowStatus).toBe('awaiting');
  });
});
```

- [ ] **Step 2: Run the test, verify it FAILS**

Run: `cd frontend && npx vitest run src/components/dashboard/__tests__/normalizeCandidateRow.test.ts`
Expected: FAIL — `normalizeCandidateRow` module does not exist.

- [ ] **Step 3: Create the helper** — create `frontend/src/components/dashboard/normalizeCandidateRow.ts`. Use the candidate row type already used by `BranchCandidates.tsx` if it is exported; otherwise type the param/return as the local row shape. Body mirrors the existing inline map at lines 2802–2812 exactly:

```ts
// Normalizes a server candidate record into the row shape the Branch
// Candidates list renders. Single source of truth for both the fetch path
// and the optimistic insert after create.
export function normalizeCandidateRow<T extends Record<string, unknown>>(candidate: T) {
  return {
    ...candidate,
    recruiter: (candidate as any).recruiter || '',
    recruiterRaw: (candidate as any).recruiterRaw || '',
    expert: (candidate as any).expert || '',
    expertRaw: (candidate as any).expertRaw || '',
    resumeLink: (candidate as any).resumeLink || '',
    resumeUnderstanding: Boolean((candidate as any).resumeUnderstanding),
    resumeUnderstandingStatus: (candidate as any).resumeUnderstandingStatus,
    workflowStatus: (candidate as any).workflowStatus,
  };
}
```

- [ ] **Step 4: Reuse it in `fetchCandidates`** — in `BranchCandidates.tsx`, import the helper at the top (`import { normalizeCandidateRow } from './normalizeCandidateRow';`) and replace the inline map (lines ~2802–2812) so the body reads:

```ts
        setCandidates((resp.candidates || []).map((candidate) => normalizeCandidateRow(candidate)));
```

- [ ] **Step 5: Run the helper test + typecheck**

Run: `cd frontend && npx vitest run src/components/dashboard/__tests__/normalizeCandidateRow.test.ts` → PASS (2 tests).
Run: `cd frontend && npx tsc --noEmit` → no new errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/dashboard/normalizeCandidateRow.ts frontend/src/components/dashboard/__tests__/normalizeCandidateRow.test.ts frontend/src/components/dashboard/BranchCandidates.tsx
git commit -m "refactor(candidates): extract normalizeCandidateRow (shared list/optimistic row shape)"
```

### Task B2: Restructure the create-callback — instant close + optimistic insert + background enrichment

**Files:**
- Modify: `frontend/src/components/dashboard/BranchCandidates.tsx` (the `socket.emit('createCandidate', …)` callback, ~lines 3448–3536)

**Context — current behavior:** the callback awaits, in order, the resume-attachment + set-as-resume (3464–3475), additional attachments (3478–3484), the Graph-token + assignment-email POST (3490–3519), the notes emit (3522–3526), then `toast` + `resetCreateState()` + `fetchCandidates()` (3529–3535). `creating` stays true (button "Submitting…") for the whole chain because `setCreating(false)` lives inside `resetCreateState()` (line 3184), which runs last. `resetCreateState()` (line 3176) also closes the dialog (`setIsCreateOpen(false)`) and CLEARS `createResumeFile` / `createAdditionalFiles` / `createForm` (notes) — so the background task must capture those values BEFORE it runs.

- [ ] **Step 1: Add the background enrichment helper.** Inside the `BranchCandidates` component, add `enrichCandidateInBackground` as an inner async function (e.g. just above `handleCreateCandidate`). It takes the captured context so it is immune to the form reset. Move the four enrichment blocks (currently 3460–3527) into it verbatim, then append the reconcile refetch:

```ts
  // Runs AFTER the create dialog has closed. The candidate already exists,
  // so every step is best-effort: a failure only surfaces a toast and the
  // user can retry from the candidate page. A final list refetch reconciles
  // the optimistic row against the active filter/sort.
  const enrichCandidateInBackground = async (ctx: {
    candidateId: string;
    resumeFile: File | null;
    additionalFiles: File[];
    notes: string;
  }) => {
    const { candidateId, resumeFile, additionalFiles, notes } = ctx;
    if (!candidateId) return;

    let resumeAttachmentId = '';
    // 1) Persist the resume as an attachment + mark it the canonical resume.
    try {
      if (resumeFile) {
        const fd = new FormData();
        fd.append('file', resumeFile);
        const r = await authFetch(`${API_URL}/api/candidates/${candidateId}/attachments`, { method: 'POST', body: fd });
        const j = await r.json();
        if (r.ok && j?.success && j?.attachment?.id) {
          resumeAttachmentId = String(j.attachment.id);
          await authFetch(`${API_URL}/api/candidates/${candidateId}/attachments/${resumeAttachmentId}/set-as-resume`, { method: 'POST' });
        }
      }
    } catch { /* non-blocking */ }

    // 2) Upload additional attachments (any format).
    for (const file of additionalFiles) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        await authFetch(`${API_URL}/api/candidates/${candidateId}/attachments/additional`, { method: 'POST', body: fd });
      } catch { /* non-blocking */ }
    }

    // 3) Send the §6.2 Assignment Email from the creator's mailbox (delegated).
    try {
      let graphToken = '';
      try { graphToken = await acquireGraphAccessToken(); } catch { /* server enqueues via outbox */ }
      const r = await authFetch(`${API_URL}/api/candidates/${candidateId}/send-assignment-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(graphToken ? { 'x-graph-access-token': graphToken } : {}) },
        body: JSON.stringify(resumeAttachmentId ? { attachmentIds: [resumeAttachmentId] } : {})
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast({ title: 'Assignment email not sent', description: j?.error || 'You can send it from the candidate page.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Assignment email not queued', description: 'You can send it from the candidate page.', variant: 'destructive' });
    }

    // 4) Save the note as a candidatecomments type='notes' entry.
    if (notes.trim()) {
      try { socket.emit('addResumeComment', { candidateId, content: notes.trim(), type: 'notes' }, () => {}); } catch { /* non-blocking */ }
    }

    // 5) Reconcile the optimistic row against the active filter/sort.
    fetchCandidates();
  };
```

- [ ] **Step 2: Rewrite the create-callback** so it releases the user immediately. Replace the callback body (lines ~3448–3536, from `socket.emit('createCandidate', payload, async (response: any) => {` through its closing `});`) with:

```ts
    socket.emit('createCandidate', payload, (response: any) => {
      if (!response?.success) {
        const details = Array.isArray(response?.details) ? response.details.join(', ') : '';
        setCreateError(response?.error || details || 'Unable to create candidate');
        setCreating(false);
        return;
      }

      const createdCandidate = response?.candidate;
      const candidateId = String(createdCandidate?.id || createdCandidate?._id || '');

      // Capture what the background enrichment needs BEFORE resetCreateState()
      // clears the form (it nulls createResumeFile / createAdditionalFiles / notes).
      const enrichmentCtx = {
        candidateId,
        resumeFile: createResumeFile,
        additionalFiles: createAdditionalFiles,
        notes: createNotes,
      };

      // Release the user immediately: close the dialog, optimistically show the
      // new row, and confirm. resetCreateState() also sets creating=false.
      resetCreateState();
      if (createdCandidate) {
        setCandidates((prev) => [normalizeCandidateRow(createdCandidate), ...prev]);
      }
      toast({
        title: 'Candidate created',
        description: 'Finishing up (resume, assignment email, notes) in the background…'
      });

      // Everything else happens off the critical path.
      void enrichCandidateInBackground(enrichmentCtx);
    });
```

Note: the callback is no longer `async` (it awaits nothing). `normalizeCandidateRow` is imported in Task B1.

- [ ] **Step 3: Typecheck + build**

Run: `cd frontend && npx tsc --noEmit` → no new errors.
Run: `cd frontend && npm run build` → succeeds.
(No render test: `BranchCandidates.tsx` is a ~5k-line socket/MSAL-driven page with no existing test harness; standing one up is out of scope. The optimistic-row correctness is covered by the `normalizeCandidateRow` test in B1; the instant-close flow is verified by tsc/build here and manual click-through below.)

- [ ] **Step 4: Manual verification (record results in the PR)**
  - Create a candidate with a resume + an additional file + notes: the dialog closes and the new row appears **immediately**; a moment later the list reconciles and (if the assignment email/token has an issue) a toast appears — without reopening the dialog.
  - Create a candidate while offline-to-Graph (deny the token): the candidate still creates instantly; the "Assignment email not queued/sent" toast appears in the background.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/dashboard/BranchCandidates.tsx
git commit -m "perf(candidates): instant create — close dialog + optimistic row, background enrichment"
```

---

## Self-Review

**1. Spec coverage:**
- Decision #1 (close dialog the instant created) → B2 Step 2 (`resetCreateState()` runs immediately in the callback). ✓
- Decision #2 (optimistic insert + background reconcile) → B2 Step 2 (`setCandidates` prepend) + B2 Step 1 (final `fetchCandidates()`). ✓
- Decision #3 (assignment email still auto-sends, backgrounded) → B2 Step 1 block 3 (moved verbatim into the background helper). ✓
- Decision #4 (resume upload stays pre-create) → unchanged: the resume upload remains on the critical path before `socket.emit` (lines ~3404–3425, not touched). ✓
- Decision #5 (de-dupe second upload only if cheap) → intentionally NOT done; the re-upload stays (now backgrounded). Documented as out-of-scope optimization in the spec. ✓
- Decision #6 (collation-indexed dup-check) → A1. ✓
- Backend test (case-insensitive find / dup-block) → A1 Step 1 (asserts the index-friendly collation exact-match query shape; DB-free). ✓
- Frontend test (closes + optimistic insert without awaiting enrichment) → covered indirectly: `normalizeCandidateRow` unit test (B1) pins the optimistic row shape; the no-await restructure is verified by tsc/build + manual (B2 Steps 3–4). The spec's "assert dialog closed before enrichment resolves" full render test is downgraded to manual due to the absence of a component test harness — noted explicitly, not silently dropped.

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; commands have expected output. The one judgement call (no render test) is stated with its reason, not hidden.

**3. Type/name consistency:** `normalizeCandidateRow` defined in B1, imported/used identically in B1 Step 4 and B2 Step 2. `enrichCandidateInBackground(ctx)` defined in B2 Step 1 with the exact `{ candidateId, resumeFile, additionalFiles, notes }` shape constructed in B2 Step 2. `getCandidateByEmail` query shape in A1 Step 3 matches the assertions in A1 Step 1 (`filter['Email ID']` string, `docType`, `options.collation`).

**Out of scope:** the de-dup upload optimization; reworking the list query; the backend create path beyond the dup-check.
