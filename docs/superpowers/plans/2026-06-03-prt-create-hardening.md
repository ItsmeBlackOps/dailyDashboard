# PRT create-flow hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the marketing create surface enforce its required fields server-side (which currently *breaks* create), open the form via a deep link, verify the existing auto-send, and give the assignment-email button a server-accurate preview (To/CC/attachments/body).

**Architecture:** Create stays `socket createCandidate → validateCandidateCreate → createCandidateFromManager`. The bug: the validator strips the PRT fields, so the service throws "Visa Type is required" on every create. Fix = forward + require the PRT fields in the validator (the service already enforces them as a backstop). Add a non-sending preview endpoint that reuses the assignment-email builder via extracted helpers. Frontend: a `?new=1` deep link and a preview-fetching modal.

**Tech Stack:** Node ESM + Express 5 + raw Mongo driver (backend, Jest); Vite + React 18 + TS + shadcn/Radix (frontend, Vitest).

---

### Task 1: Forward + require PRT fields in `validateCandidateCreate` (unbreaks create)

**Files:**
- Modify: `backend/src/middleware/validation.js` (`validateCandidateCreate`, ~647–715; add an import at top, ~line 8)
- Test: `backend/test/validation.candidateCreate.test.js` (create)

- [ ] **Step 1: Write the failing test**

```js
// backend/test/validation.candidateCreate.test.js
import { describe, it, expect } from '@jest/globals';
import { validateCandidateCreate } from '../src/middleware/validation.js';

const base = {
  name: 'Asha Rao', email: 'asha@x.com', technology: 'Software Developer',
  recruiter: 'rec@x.com', branch: 'AHM', resumeLink: 'https://x/r.pdf',
  contact: '+12193688385', experienceYears: 5, visaType: 'H1B', company: 'SST',
  city: 'Austin', state: 'TX',
};

describe('validateCandidateCreate — PRT mandatory fields', () => {
  it('accepts a complete payload and forwards the PRT fields', () => {
    const { isValid, payload, errors } = validateCandidateCreate(base);
    expect(errors).toEqual([]);
    expect(isValid).toBe(true);
    expect(payload).toMatchObject({
      visaType: 'H1B', company: 'SST', experienceYears: 5,
      city: 'Austin', state: 'TX', contact: '+12193688385',
    });
  });

  it('rejects when visaType is missing', () => {
    const { isValid, errors } = validateCandidateCreate({ ...base, visaType: undefined });
    expect(isValid).toBe(false);
    expect(errors.join(' ')).toMatch(/visaType/i);
  });

  it('rejects an unknown visaType / company enum', () => {
    expect(validateCandidateCreate({ ...base, visaType: 'BOGUS' }).isValid).toBe(false);
    expect(validateCandidateCreate({ ...base, company: 'BOGUS' }).isValid).toBe(false);
  });

  it('rejects experienceYears out of 1..20 or non-integer', () => {
    expect(validateCandidateCreate({ ...base, experienceYears: 0 }).isValid).toBe(false);
    expect(validateCandidateCreate({ ...base, experienceYears: 21 }).isValid).toBe(false);
    expect(validateCandidateCreate({ ...base, experienceYears: 2.5 }).isValid).toBe(false);
  });

  it('requires contact', () => {
    expect(validateCandidateCreate({ ...base, contact: '' }).isValid).toBe(false);
  });

  it('requires EAD dates only for EAD-card visas, end > start', () => {
    const opt = { ...base, visaType: 'OPT' }; // OPT is an EAD-card type
    expect(validateCandidateCreate(opt).isValid).toBe(false); // missing EAD
    expect(validateCandidateCreate({ ...opt, eadStartDate: '2026-01-01', eadEndDate: '2025-01-01' }).isValid).toBe(false);
    const ok = validateCandidateCreate({ ...opt, eadStartDate: '2026-01-01', eadEndDate: '2027-01-01' });
    expect(ok.isValid).toBe(true);
    expect(ok.payload).toMatchObject({ eadStartDate: '2026-01-01', eadEndDate: '2027-01-01' });
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd backend && node --experimental-vm-modules node_modules/jest/bin/jest.js test/validation.candidateCreate.test.js`
Expected: FAIL (PRT fields absent from payload; no enum errors).

> Confirm `OPT` ∈ `EAD_REQUIRED_VISA_TYPES` in `backend/src/models/Candidate.js` (line ~176). If not, pick any member of that Set for the EAD test.

- [ ] **Step 3: Implement**

Add the import near the top of `validation.js` (after the logger import, ~line 8):
```js
import { VISA_TYPE_VALUES, COMPANY_VALUES, EAD_REQUIRED_VISA_TYPES } from '../models/Candidate.js';
```

In `validateCandidateCreate`, **replace** the existing optional-contact block:
```js
  if (contact !== undefined) {
    payload.contact = contact.toString().trim();
  }
```
with a required check, and **insert** the PRT-field block just before the final `return { isValid: ... }`:
```js
  if (!contact || typeof contact !== 'string' || contact.trim().length === 0) {
    errors.push('contact is required');
  } else {
    payload.contact = contact.toString().trim();
  }

  // ---- PRT marketing fields (Branch Candidates create is marketing-only) ----
  const { visaType, company, experienceYears, city, state, eadStartDate, eadEndDate } = data;

  if (!visaType || typeof visaType !== 'string' || !VISA_TYPE_VALUES.includes(visaType.trim())) {
    errors.push('visaType is required and must be a valid visa type');
  } else {
    payload.visaType = visaType.trim();
  }

  if (!company || typeof company !== 'string' || !COMPANY_VALUES.includes(company.trim().toUpperCase())) {
    errors.push(`company is required and must be one of ${COMPANY_VALUES.join(', ')}`);
  } else {
    payload.company = company.trim().toUpperCase();
  }

  const expNum = Number(experienceYears);
  if (experienceYears === undefined || experienceYears === null || experienceYears === ''
      || !Number.isInteger(expNum) || expNum < 1 || expNum > 20) {
    errors.push('experienceYears is required and must be an integer from 1 to 20');
  } else {
    payload.experienceYears = expNum;
  }

  if (!city || typeof city !== 'string' || city.trim().length === 0) {
    errors.push('city is required');
  } else { payload.city = city.trim(); }

  if (!state || typeof state !== 'string' || state.trim().length === 0) {
    errors.push('state is required');
  } else { payload.state = state.trim(); }

  const visaNeedsEad = payload.visaType && EAD_REQUIRED_VISA_TYPES.has(payload.visaType);
  if (visaNeedsEad) {
    if (!eadStartDate || typeof eadStartDate !== 'string' || !eadStartDate.trim()) {
      errors.push('eadStartDate is required for this visa type');
    } else { payload.eadStartDate = eadStartDate.trim(); }
    if (!eadEndDate || typeof eadEndDate !== 'string' || !eadEndDate.trim()) {
      errors.push('eadEndDate is required for this visa type');
    } else { payload.eadEndDate = eadEndDate.trim(); }
    if (payload.eadStartDate && payload.eadEndDate
        && new Date(payload.eadEndDate) <= new Date(payload.eadStartDate)) {
      errors.push('eadEndDate must be after eadStartDate');
    }
  } else {
    if (typeof eadStartDate === 'string' && eadStartDate.trim()) payload.eadStartDate = eadStartDate.trim();
    if (typeof eadEndDate === 'string' && eadEndDate.trim()) payload.eadEndDate = eadEndDate.trim();
  }
```

- [ ] **Step 4: Run, verify pass.** Then run the existing socket/service create tests to confirm nothing regressed: `node --experimental-vm-modules node_modules/jest/bin/jest.js test/validation candidateService.prt`
- [ ] **Step 5: Commit** — `git commit -am "fix(candidates): forward + require PRT fields in create validator (unbreaks marketing create)"`

---

### Task 2: Frontend — make `contact` required in the create form

**Files:**
- Modify: `frontend/src/components/dashboard/BranchCandidates.tsx` (the contact label ~"Contact (optional)" ~line 4747; `handleCreateCandidate` validation ~3213; the payload build ~3380 `if (trimmedContact) payload.contact = ...`)

- [ ] **Step 1:** Change the label `Contact (optional)` → `Contact — required`.
- [ ] **Step 2:** In `handleCreateCandidate`, add a guard (after the recruiter checks, alongside the other PRT required checks):
```js
    if (!trimmedContact) {
      setCreateError('Contact is required');
      setCreating(false);
      return;
    }
```
- [ ] **Step 3:** Change the payload build from `if (trimmedContact) payload.contact = trimmedContact;` to always include it: `payload.contact = trimmedContact;`
- [ ] **Step 4:** Typecheck `cd frontend && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -am "feat(candidates): require contact in the create form"`

---

### Task 3: Backend — extract assignment-email helpers + add byte-less preview builder

**Files:**
- Modify: `backend/src/services/assignmentEmailService.js` (`buildAssignmentEmail`, ~97–209)
- Test: `backend/test/assignmentEmailService.preview.test.js` (create)

The send path's `buildAssignmentEmail` throws on attachments without `contentBytesBase64`. Extract the byte-independent parts so a preview can reuse them without bytes.

- [ ] **Step 1: Write the failing test**

```js
// backend/test/assignmentEmailService.preview.test.js
import { describe, it, expect } from '@jest/globals';
import { buildAssignmentEmailPreview } from '../src/services/assignmentEmailService.js';

const args = {
  candidateName: 'Asha Rao', technology: 'Software Developer', visaType: 'H1B',
  recruiterEmail: 'rec@x.com', recruiterDisplayName: 'Rec X',
  teamLeadEmail: 'tl@x.com', teamLeadDisplayName: 'TL X',
  managerEmail: 'mgr@x.com', permanentCcEmail: 'tushar.ahuja@silverspaceinc.com',
  senderEmail: 'me@x.com', senderDisplayName: 'Me',
  attachments: [{ id: 'a1', filename: 'resume.pdf', mimeType: 'application/pdf' }], // NO bytes
  appendBody: 'Please prioritise.',
};

describe('buildAssignmentEmailPreview', () => {
  it('builds recipients/subject/body from metadata without bytes', () => {
    const p = buildAssignmentEmailPreview(args);
    expect(p.to).toEqual(['rec@x.com']);
    expect(p.cc).toEqual(expect.arrayContaining(['mgr@x.com', 'tl@x.com', 'tushar.ahuja@silverspaceinc.com']));
    expect(p.subject).toContain('Asha Rao');
    expect(p.bodyHtml).toContain('Please prioritise.');   // appendBody prepended
    expect(p.bodyHtml).toContain('Hi TL X,');
    expect(p.attachments).toEqual([{ id: 'a1', filename: 'resume.pdf' }]);
  });

  it('still sends correctly: buildAssignmentEmail unchanged for byte-carrying attachments', async () => {
    const { buildAssignmentEmail } = await import('../src/services/assignmentEmailService.js');
    const sent = buildAssignmentEmail({ ...args, attachments: [{ id: 'a1', filename: 'resume.pdf', mimeType: 'application/pdf', contentBytesBase64: 'AAAA' }] });
    expect(sent.message.attachments[0].contentBytes).toBe('AAAA');
    expect(sent._audit.to).toEqual(['rec@x.com']);
  });
});
```

- [ ] **Step 2: Run, verify fail** (`buildAssignmentEmailPreview` not exported).

- [ ] **Step 3: Implement** — refactor `buildAssignmentEmail` to call three small internal helpers, then add the preview export. Keep `buildAssignmentEmail`'s existing byte validation + output identical.

```js
// internal helpers (module scope, not exported)
function assignmentSubject({ candidateName, technology, visaType }) {
  return `Assignment: ${candidateName} – ${technology || SAFE_TEXT_FALLBACK} – ${visaType || SAFE_TEXT_FALLBACK}`;
}
function assignmentBodyHtml({ teamLeadDisplayName, senderDisplayName, recruiterDisplayName, appendBody }) {
  const sectionsHtml = TEMPLATE_LINES.map((token) => {
    switch (token) {
      case '__GREETING__': return paragraphHtml(`Hi ${teamLeadDisplayName},`);
      case '__SENDER__': return paragraphHtml(senderDisplayName);
      case '__LIST_COMPLIANCE__': return listHtml(COMPLIANCE_BULLETS);
      case '__LIST_DOCUMENTS__': return listHtml(DOCUMENT_BULLETS);
      default: return paragraphHtml(token.replace('__RECRUITER__', recruiterDisplayName));
    }
  }).join('');
  const prepend = appendBody && String(appendBody).trim().length > 0
    ? `${paragraphHtml(String(appendBody).trim())}<hr/>` : '';
  return `${prepend}${sectionsHtml}`;
}
function assignmentRecipients({ recruiterEmail, managerEmail, teamLeadEmail, permanentCcEmail }) {
  return {
    toEmails: dedupeLower([recruiterEmail]),
    ccEmails: dedupeLower([managerEmail, teamLeadEmail, permanentCcEmail]),
  };
}
function assertCommonArgs(a) {
  if (!a.candidateName) throw err('Candidate Name is required');
  if (!a.recruiterEmail) throw err('Recruiter email is required');
  if (!a.recruiterDisplayName) throw err('Recruiter name is required');
  if (!a.teamLeadDisplayName) throw err('Team Lead is required');
  if (!a.senderDisplayName) throw err('Sender display name is required');
  if (!a.permanentCcEmail) throw err('Permanent CC is not configured');
  if (!Array.isArray(a.attachments) || a.attachments.length === 0) throw err('At least one attachment is required');
}
```

Rewrite `buildAssignmentEmail` to use them (behavior unchanged — keep the per-attachment byte check + the full `message`/`_audit`):
```js
export function buildAssignmentEmail(args = {}) {
  assertCommonArgs(args);
  for (const a of args.attachments) {
    if (!a || !a.filename || !a.mimeType || !a.contentBytesBase64) throw err('Invalid attachment payload');
  }
  const subject = assignmentSubject(args);
  const bodyHtml = assignmentBodyHtml(args);
  const { toEmails, ccEmails } = assignmentRecipients(args);
  return {
    message: {
      subject,
      body: { contentType: 'HTML', content: bodyHtml },
      toRecipients: toEmails.map((address) => ({ emailAddress: { address } })),
      ccRecipients: ccEmails.map((address) => ({ emailAddress: { address } })),
      bccRecipients: [],
      attachments: args.attachments.map((a) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: a.filename, contentType: a.mimeType, contentBytes: a.contentBytesBase64,
      })),
    },
    saveToSentItems: true,
    _audit: { subject, senderEmail: (args.senderEmail || '').toLowerCase(), to: toEmails, cc: ccEmails, bcc: [], attachmentIds: args.attachments.map((a) => a.id).filter(Boolean) },
  };
}

// Preview: same recipients/subject/body, attachment FILENAMES only (no bytes, no send).
export function buildAssignmentEmailPreview(args = {}) {
  assertCommonArgs(args);
  for (const a of args.attachments) {
    if (!a || !a.filename) throw err('Invalid attachment payload');
  }
  const { toEmails, ccEmails } = assignmentRecipients(args);
  return {
    to: toEmails,
    cc: ccEmails,
    bcc: [],
    subject: assignmentSubject(args),
    bodyHtml: assignmentBodyHtml(args),
    attachments: args.attachments.map((a) => ({ id: a.id, filename: a.filename })),
  };
}
```

- [ ] **Step 4: Run, verify pass.** Also run the existing `assignmentEmailService` tests — output must be unchanged: `node --experimental-vm-modules node_modules/jest/bin/jest.js test/assignmentEmailService`
- [ ] **Step 5: Commit** — `git commit -am "refactor(prt): extract assignment-email helpers + add byte-less preview builder"`

---

### Task 4: Backend — preview service method + controller + route

**Files:**
- Modify: `backend/src/services/candidateService.js` (add `buildAssignmentEmailPreview` near `sendAssignmentEmail`, ~2199)
- Modify: `backend/src/controllers/candidateController.js` (add `previewAssignmentEmail` near `sendAssignmentEmail`, ~251)
- Modify: `backend/src/routes/candidates.js` (add route near the send route, ~123)
- Test: `backend/test/candidateController.previewAssignmentEmail.test.js` (create) — mirror `candidateController.getCandidateById.test.js` harness

- [ ] **Step 1: Write the failing test** (controller-level; mock `candidateService.buildAssignmentEmailPreview`):

```js
// mirror the getCandidateById harness: mock Candidate.js, logger, database, User.js,
// storageService, resumeProfileService, candidateStatusService, and
// candidateService: { buildAssignmentEmailPreview: mockPreview }
// VALID_ID = 'a'.repeat(24)
it('200 returns the preview shape', async () => {
  mockPreview.mockResolvedValue({ to: ['rec@x.com'], cc: ['tl@x.com'], bcc: [], subject: 'Assignment: …', bodyHtml: '<p>Hi</p>', attachments: [{ id: 'a1', filename: 'r.pdf' }] });
  const r = res();
  await candidateController.previewAssignmentEmail({ user: { email: 'a@x.com', role: 'admin' }, params: { id: VALID_ID }, body: {} }, r);
  expect(r.statusCode).toBe(200);
  expect(r.body.preview.to).toEqual(['rec@x.com']);
});
it('maps a service 400 (gate failure)', async () => {
  const e = new Error('At least one attachment is required to send the assignment email'); e.statusCode = 400;
  mockPreview.mockRejectedValue(e);
  const r = res();
  await candidateController.previewAssignmentEmail({ user: { email: 'a@x.com', role: 'admin' }, params: { id: VALID_ID }, body: {} }, r);
  expect(r.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.**

Service — `candidateService.buildAssignmentEmailPreview(user, candidateId, options = {})`. Mirror `sendAssignmentEmail` (lines ~2199–2313) for auth + gate + recipient resolution, but: (a) build `selected` attachment **metadata** only, (b) **do not** call `storageService.fetchObjectAsBase64`, (c) call `buildAssignmentEmailPreview` (imported from assignmentEmailService) instead of `buildAssignmentEmail`, (d) **do not** send / write / publish. Skeleton:
```js
async buildAssignmentEmailPreview(user, candidateId, options = {}) {
  // --- identical auth + role gate + candidate fetch + _assertAttachmentPermission
  //     + recruiter/teamLead/attachment gate + display-name/manager/permanentCc
  //     resolution as sendAssignmentEmail (copy lines ~2200–2290) ---
  const selected = /* same attachment-selection logic as send (options.attachmentIds) */;
  const preview = buildAssignmentEmailPreview({
    candidateName: candidate.name || candidate['Candidate Name'] || '',
    technology: candidate.technology || candidate.Technology || '',
    visaType: candidate.visaType || '',
    recruiterEmail, recruiterDisplayName,
    teamLeadEmail: teamLeadEmailStored, teamLeadDisplayName,
    managerEmail, permanentCcEmail,
    senderEmail: user.email, senderDisplayName,
    attachments: selected.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType })),
    appendBody: options.appendBody || '',
  });
  if (options.subject && typeof options.subject === 'string' && options.subject.trim()) {
    preview.subject = options.subject.trim();
  }
  return preview;
}
```
Add the import at the top of candidateService.js: `import { buildAssignmentEmail, buildAssignmentEmailPreview } from './assignmentEmailService.js';` (extend the existing import if `buildAssignmentEmail` is already imported).

Controller — `previewAssignmentEmail(req, res)` (mirror `sendAssignmentEmail` 251–300 minus the token):
```js
async previewAssignmentEmail(req, res) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
    const { id: candidateId } = req.params;
    const body = req.body || {};
    const preview = await candidateService.buildAssignmentEmailPreview(user, candidateId, {
      appendBody: body.appendBody, attachmentIds: body.attachmentIds, subject: body.subject,
    });
    return res.status(200).json({ success: true, preview });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('previewAssignmentEmail failed', { error: error.message, candidateId: req.params?.id, userEmail: req.user?.email });
    return res.status(status).json({ success: false, error: status === 500 ? 'Unable to build preview' : error.message });
  }
}
```

Route — in `backend/src/routes/candidates.js`, after the send-assignment-email route (~123):
```js
router.post('/:id/assignment-email/preview', (req, res) => candidateController.previewAssignmentEmail(req, res));
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(prt): assignment-email preview endpoint (builds without sending)"`

---

### Task 5: Frontend — deep-link auto-open the Add Candidate form

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx` (the "Move to Marketing" item, href ~line 440)
- Modify: `frontend/src/components/dashboard/BranchCandidates.tsx` (`isCreateOpen` state ~507; add a mount effect)
- Test: `frontend/src/components/dashboard/__tests__/BranchCandidates.deeplink.test.tsx` (create) — if mounting the full component is impractical, assert the effect logic via a small wrapper; otherwise smoke-test that `?new=1` opens the dialog.

- [ ] **Step 1:** Sidebar — change the "Move to Marketing" `href` to `/branch-candidates?new=1`. Leave the plain "Branch Candidates" item at `/branch-candidates`.
- [ ] **Step 2:** BranchCandidates — add, after the `isCreateOpen` state:
```tsx
import { useSearchParams } from 'react-router-dom';
// ...
const [searchParams, setSearchParams] = useSearchParams();
const newParamHandled = useRef(false);
useEffect(() => {
  if (newParamHandled.current) return;
  if (searchParams.get('new') === '1') {
    newParamHandled.current = true;
    setIsCreateOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }
}, [searchParams, setSearchParams]);
```
(Ensure `useEffect`, `useRef` are imported.)
- [ ] **Step 3:** Typecheck `cd frontend && npx tsc --noEmit`.
- [ ] **Step 4:** Run any new test: `npx vitest run src/components/dashboard/__tests__/BranchCandidates.deeplink.test.tsx`.
- [ ] **Step 5: Commit** — `git commit -am "feat(prt): deep-link (?new=1) opens the Add Candidate form; Move to Marketing uses it"`

---

### Task 6: Frontend — AssignmentEmailModal server-accurate preview

**Files:**
- Modify: `frontend/src/components/candidates/AssignmentEmailModal.tsx`
- Test: `frontend/src/components/candidates/__tests__/AssignmentEmailModal.test.tsx` (create or extend)

- [ ] **Step 1: Write the failing test** — mock `useAuth().authFetch` to resolve the preview endpoint with `{ success:true, preview:{ to:['rec@x.com'], cc:['tl@x.com','tushar.ahuja@silverspaceinc.com'], bcc:[], subject:'Assignment: Asha', bodyHtml:'<p>Hi TL</p>', attachments:[{id:'a1',filename:'r.pdf'}] } }`. Assert that opening the modal renders the recruiter in To, the CC chips (incl. Tushar), the filename `r.pdf`, and body text `Hi TL`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.** On open (and on debounced change of `subject` / `appendBody` / `selectedAttachmentIds`), POST `/api/candidates/${candidateId}/assignment-email/preview` with `{ subject, appendBody, attachmentIds: Array.from(selectedAttachmentIds) }`. Store `preview` in state. Render:
  - To: `preview.to.join(', ')`
  - CC: chips for each `preview.cc`
  - BCC: chips for each `preview.bcc` (if any)
  - Attachments: list `preview.attachments.map(a => a.filename)`
  - Body: a read-only scrollable panel — `dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(preview.bodyHtml) }}` (import `DOMPurify` — confirm it is already a dependency used elsewhere in the repo; if not, render the body as sanitized text). Replace the old "uses the §6.2 template" note + the manager placeholder chip.
  - While fetching: a spinner; on a gate-400 response: show `error` text in place of the preview and disable Send.
  Keep the editable `subject` + `appendBody` inputs and the Send button (unchanged endpoint). Debounce the refetch ~300ms.

- [ ] **Step 4:** Typecheck + run the test: `cd frontend && npx tsc --noEmit && npx vitest run src/components/candidates/__tests__/AssignmentEmailModal.test.tsx`
- [ ] **Step 5: Commit** — `git commit -am "feat(prt): assignment-email modal renders server-accurate To/CC/attachments/body preview"`

---

### Task 7: Frontend — auto-send verification test

**Files:**
- Test: `frontend/src/components/dashboard/__tests__/BranchCandidates.autosend.test.tsx` (create)

Auto-send is already implemented in `handleCreateCandidate`; this task only locks it with a test (no source change unless the test reveals a bug).

- [ ] **Step 1:** Write a test that mounts the create flow (or extracts/exercises the post-create logic): given a successful `createCandidate` socket callback returning `{ success:true, candidate:{ id } }`, assert `authFetch` is called for `/attachments`, `/set-as-resume`, and `/send-assignment-email` (with `attachmentIds`), and that a non-OK `/send-assignment-email` response triggers the "Assignment email not sent" toast without throwing.
- [ ] **Step 2:** Run it. If it passes, the behavior is verified. If it fails, fix `handleCreateCandidate` minimally (debug → root cause) and re-run.
- [ ] **Step 3: Commit** — `git commit -am "test(prt): cover auto-send assignment email on create"`

---

### Task 8: Full verify + PR

- [ ] **Step 1:** Backend: `cd backend && node --experimental-vm-modules node_modules/jest/bin/jest.js test/validation.candidateCreate test/assignmentEmailService test/candidateController` — all green. (Atlas-dependent integration suites may fail offline — diff against main, per CLAUDE.md.)
- [ ] **Step 2:** Frontend: `cd frontend && npx tsc --noEmit && npx vitest run src/components/candidates src/components/dashboard/__tests__/BranchCandidates.deeplink.test.tsx src/components/dashboard/__tests__/BranchCandidates.autosend.test.tsx`
- [ ] **Step 3:** Manual smoke (note for the user to run on the deploy): create with a missing field via a crafted socket payload → rejected with the field error; "Move to Marketing" opens the form; a full create sends the email automatically; the button modal shows exact recipients + the rendered body.
- [ ] **Step 4:** Open PR `feat/prt-create-hardening → main`. Title: `feat(prt): harden create — mandatory fields, deep-link form, auto-send verify, email preview`. Body: summarize the four parts + the create-was-broken root cause. **No AI-attribution trailers.**

---

## Notes / invariants
- The create-validator fix is the load-bearing change: it *unbreaks* create (the service already throws "Visa Type is required" because the validator strips the field). Verify create end-to-end after deploy.
- The preview endpoint must reuse the exact send gate (`PRT_ATTACHMENT_ROLES` + `_assertAttachmentPermission`) so it can't leak PRT data to non-marketing roles, and must never read S3 bytes.
- Do not change the §6.2 template content. SP3 (ISO-date filtering/sorting) is the next, separate spec.
