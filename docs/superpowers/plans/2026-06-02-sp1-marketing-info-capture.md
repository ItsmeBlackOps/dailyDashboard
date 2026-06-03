# SP1 — Marketing-info Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Visa Type / EAD / Company hard-required at candidate creation, and surface the existing candidates that are missing them as a role-scoped "needs marketing info" worklist the marketing team can fill.

**Architecture:** Backend adds (1) a reusable Mongo "missing marketing info" filter, (2) an in-memory `needsMarketingInfo` flag on every formatted candidate record (stripped for non-marketing roles), (3) create-time required guards in `createCandidateFromManager`, and (4) an HTTP worklist endpoint mirroring the existing `getPOMissingDate` controller (reusing `_scopeFilter`, which already includes self + hierarchy for every role). Frontend makes the create-form fields required, adds a "Needs info" badge + filter + count to the role-scoped Branch Candidates view, and a focused `MarketingInfoModal` to fill an existing record through the existing update endpoint.

**Tech Stack:** Node ESM + Express 5 + raw MongoDB driver + Jest (backend); Vite + React 18 + TS + shadcn/ui + Vitest (frontend).

**Branch:** `feat/sp1-visa-marketing-info` (already created, rebased on main incl. PR #156).

**Spec:** `docs/superpowers/specs/2026-06-02-sp1-marketing-info-capture-design.md`

---

## File Structure

**Backend**
- `backend/src/models/Candidate.js` — add exported `marketingInfoMissingFilter()` (Mongo `$or`). `EAD_REQUIRED_VISA_TYPES`/`VISA_TYPE_VALUES`/`COMPANY_VALUES` already live here.
- `backend/src/services/candidateService.js` — add `missingMarketingFields()` + `candidateNeedsMarketingInfo()`; set `needsMarketingInfo`/`missingMarketingFields` in `formatCandidateRecord` (~line 812); add the 5 create-time guards in `createCandidateFromManager` (~line 2341); add the two new field names to the PRT visibility strip list.
- `backend/src/controllers/candidateController.js` — add `getMarketingInfoWorklist` (mirror `getPOMissingDate`, line ~336); import `marketingInfoMissingFilter`.
- `backend/src/routes/candidates.js` — register `GET /marketing-info-worklist` BEFORE `/:id` (line ~125).
- Tests: `backend/test/candidate.marketingInfo.test.js` (helper + service), `backend/test/candidateController.marketingInfoWorklist.test.js` (controller).

**Frontend**
- `frontend/src/components/dashboard/MarketingInfoModal.tsx` *(new)* — fill visa/EAD/company on an existing candidate.
- `frontend/src/components/dashboard/BranchCandidates.tsx` — make create-form fields required; add "Needs info" badge + filter chip + count; wire the modal.
- Test: `frontend/src/components/dashboard/__tests__/MarketingInfoModal.test.tsx` *(new)*.

---

## Conventions (read once before starting)

- **Run backend tests:** `cd backend && npm test -- <file>` (Jest, experimental ESM). DB-dependent tests fail offline with `querySrv ECONNREFUSED` — the tests below are unit tests with mocks and do NOT need a DB.
- **Run frontend checks:** `cd frontend && npx tsc --noEmit` and `cd frontend && npx vitest run <file>`.
- **`req.user.role` is already the legacy token** (`authenticateHTTP` runs `toLegacyRole`). Gate on legacy names (`admin/mm/mam/mlead/recruiter`), exactly like `getPOMissingDate`.
- **Commit messages:** plain subject + optional body. **No AI-attribution trailers** (`Co-Authored-By`, `Generated with…`, 🤖). This is a hard project rule.
- **"Needs marketing info"** is defined ONLY as visa/company/conditional-EAD (NOT experienceYears/city/state — those are create-time-only requirements, not retro-flagged on the 1,412 existing records).

---

## Task 1: Reusable "missing marketing info" Mongo filter

**Files:**
- Modify: `backend/src/models/Candidate.js` (add near the other exported enum constants, after `COMPANY_VALUES` ~line 185)
- Test: `backend/test/candidate.marketingInfo.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/test/candidate.marketingInfo.test.js`:

```js
import { describe, it, expect } from '@jest/globals';
import { marketingInfoMissingFilter, EAD_REQUIRED_VISA_TYPES } from '../src/models/Candidate.js';

describe('marketingInfoMissingFilter', () => {
  it('returns an $or with visaType + company emptiness branches and an EAD-conditional branch', () => {
    const f = marketingInfoMissingFilter();
    expect(Array.isArray(f.$or)).toBe(true);
    // visaType empty/missing, company empty/missing
    expect(f.$or).toEqual(expect.arrayContaining([
      { visaType: { $in: [null, ''] } },
      { visaType: { $exists: false } },
      { company: { $in: [null, ''] } },
      { company: { $exists: false } },
    ]));
    // EAD-conditional branch: visa in the EAD set AND (start or end empty)
    const eadBranch = f.$or.find((c) => c.$and);
    expect(eadBranch).toBeTruthy();
    expect(eadBranch.$and[0]).toEqual({ visaType: { $in: Array.from(EAD_REQUIRED_VISA_TYPES) } });
    expect(Array.isArray(eadBranch.$and[1].$or)).toBe(true);
  });

  it('is a pure function (no args, stable shape)', () => {
    expect(JSON.stringify(marketingInfoMissingFilter())).toBe(JSON.stringify(marketingInfoMissingFilter()));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- candidate.marketingInfo.test.js`
Expected: FAIL — `marketingInfoMissingFilter is not a function` / import error.

- [ ] **Step 3: Implement the filter**

In `backend/src/models/Candidate.js`, after the `COMPANY_VALUES` export (~line 185), add:

```js
// SP1 — a candidate "needs marketing info" when Visa Type or Company is
// blank, or when its visa carries an EAD card (EAD_REQUIRED_VISA_TYPES) but
// the EAD start/end dates are blank. This is the single source of truth for
// the DB-side worklist query; the in-memory equivalent lives in
// candidateService.missingMarketingFields (kept in lock-step).
export function marketingInfoMissingFilter() {
  const eadTypes = Array.from(EAD_REQUIRED_VISA_TYPES);
  const blank = (field) => ([
    { [field]: { $in: [null, ''] } },
    { [field]: { $exists: false } },
  ]);
  return {
    $or: [
      ...blank('visaType'),
      ...blank('company'),
      {
        $and: [
          { visaType: { $in: eadTypes } },
          { $or: [...blank('eadStartDate'), ...blank('eadEndDate')] },
        ],
      },
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- candidate.marketingInfo.test.js`
Expected: PASS (both `marketingInfoMissingFilter` tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/models/Candidate.js backend/test/candidate.marketingInfo.test.js
git commit -m "feat(prt): add marketingInfoMissingFilter() for the SP1 worklist query"
```

---

## Task 2: `needsMarketingInfo` flag on candidate records

**Files:**
- Modify: `backend/src/services/candidateService.js` — add helpers near the other PRT helpers; set the flag in `formatCandidateRecord` (~line 812); add the two field names to the PRT visibility strip list (search for the existing `PRT_VISIBLE_FIELDS`/`_applyPrtVisibility` list, added in P1i).
- Test: append to `backend/test/candidate.marketingInfo.test.js`

- [ ] **Step 1: Write the failing test**

Append to `backend/test/candidate.marketingInfo.test.js`. This imports the service singleton and exercises the pure predicate (no DB):

```js
import { candidateService } from '../src/services/candidateService.js';

describe('candidateService.missingMarketingFields', () => {
  it('flags blank visaType and company', () => {
    const m = candidateService.missingMarketingFields({ visaType: '', company: null });
    expect(m).toEqual(expect.arrayContaining(['visaType', 'company']));
  });

  it('requires EAD dates only for EAD-card visa types', () => {
    expect(candidateService.missingMarketingFields({ visaType: 'OPT', company: 'SST' }))
      .toEqual(expect.arrayContaining(['eadStartDate', 'eadEndDate']));
    // Non-EAD visa with company set => nothing missing
    expect(candidateService.missingMarketingFields({ visaType: 'H1B', company: 'SST' }))
      .toEqual([]);
  });

  it('candidateNeedsMarketingInfo is true iff something is missing', () => {
    expect(candidateService.candidateNeedsMarketingInfo({ visaType: 'H1B', company: 'VCS' })).toBe(false);
    expect(candidateService.candidateNeedsMarketingInfo({ visaType: '', company: 'VCS' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- candidate.marketingInfo.test.js`
Expected: FAIL — `candidateService.missingMarketingFields is not a function`.

- [ ] **Step 3: Implement the helpers + wire the flag**

In `backend/src/services/candidateService.js`:

(a) Add these two methods to the `candidateService` class (place them next to the other small PRT helpers, e.g. just above `formatCandidateRecord`). `EAD_REQUIRED_VISA_TYPES` is already imported at the top of the file (line ~10):

```js
  // SP1 — in-memory mirror of marketingInfoMissingFilter (DB side). Keep the
  // two in lock-step. "Marketing info" = visaType + company + conditional EAD.
  missingMarketingFields(candidate) {
    const isBlank = (v) => v === null || v === undefined
      || (typeof v === 'string' && v.trim() === '');
    const missing = [];
    if (isBlank(candidate?.visaType)) missing.push('visaType');
    if (isBlank(candidate?.company)) missing.push('company');
    const visa = (candidate?.visaType || '').toString().trim();
    if (EAD_REQUIRED_VISA_TYPES.has(visa)) {
      if (isBlank(candidate?.eadStartDate)) missing.push('eadStartDate');
      if (isBlank(candidate?.eadEndDate)) missing.push('eadEndDate');
    }
    return missing;
  }

  candidateNeedsMarketingInfo(candidate) {
    return this.missingMarketingFields(candidate).length > 0;
  }
```

(b) In `formatCandidateRecord`, after the `formatted` object is fully built and BEFORE the `return this._applyPrtVisibility(formatted, user);` line, add:

```js
    formatted.missingMarketingFields = this.missingMarketingFields(formatted);
    formatted.needsMarketingInfo = formatted.missingMarketingFields.length > 0;
```

(c) Add `'needsMarketingInfo'` and `'missingMarketingFields'` to the PRT visibility strip list (the `PRT_VISIBLE_FIELDS` array introduced in P1i, near the top of the file) so non-marketing roles never receive the flag. Find the array literal that already contains `'visaType'`, `'eadStartDate'`, `'company'`, etc., and append the two new names.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- candidate.marketingInfo.test.js`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/candidateService.js backend/test/candidate.marketingInfo.test.js
git commit -m "feat(prt): add needsMarketingInfo flag to candidate records (stripped for non-marketing)"
```

---

## Task 3: Hard-require marketing fields at creation

**Files:**
- Modify: `backend/src/services/candidateService.js` — `createCandidateFromManager` (~line 2341), after the existing `recruiter`/`name`/`email`/`teamLead` guards and before the duplicate-guard / `candidateModel.createCandidate(...)` call.
- Test: `backend/test/candidateService.createRequired.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/test/candidateService.createRequired.test.js`. Mock the model + user lookups so `createCandidateFromManager` reaches the new guards without a DB:

```js
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockCreate = jest.fn();
const mockGetByEmail = jest.fn();
jest.unstable_mockModule('../src/models/Candidate.js', async () => {
  const actual = await import('../src/models/Candidate.js');
  return {
    ...actual,
    candidateModel: {
      collection: {},
      createCandidate: mockCreate,
      getCandidateByEmail: mockGetByEmail,
    },
  };
});

const { candidateService } = await import('../src/services/candidateService.js');

const basePayload = () => ({
  name: 'Test Cand', email: 'cand@example.com', recruiter: 'rec@silverspaceinc.com',
  teamLead: 'lead@silverspaceinc.com', branch: 'GGR', resumeLink: 'https://x/r.pdf',
  technology: 'Java', contact: '123', experienceYears: 5,
  visaType: 'H1B', company: 'SST', city: 'Dallas', state: 'TX',
});
const admin = { email: 'admin@silverspaceinc.com', role: 'admin' };

beforeEach(() => { jest.clearAllMocks(); mockGetByEmail.mockResolvedValue(null); mockCreate.mockResolvedValue({ _id: '1', ...basePayload() }); });

describe('createCandidateFromManager required marketing fields', () => {
  for (const field of ['visaType', 'company', 'experienceYears', 'city', 'state']) {
    it(`rejects when ${field} is missing`, async () => {
      const payload = basePayload();
      delete payload[field];
      await expect(candidateService.createCandidateFromManager(admin, payload)).rejects.toThrow();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  }

  it('accepts a complete payload (additional attachments not required)', async () => {
    await expect(candidateService.createCandidateFromManager(admin, basePayload())).resolves.toBeTruthy();
    expect(mockCreate).toHaveBeenCalled();
  });
});
```

> If the existing test suite already has a mock harness for `createCandidateFromManager` (check `backend/test/` for a candidateService create test), mirror its mock setup instead of the above to avoid divergent mocking. The assertions (reject-per-missing-field, accept-when-complete) stay the same.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- candidateService.createRequired.test.js`
Expected: FAIL — complete-payload passes, but the "rejects when X missing" cases FAIL because the guards don't exist yet (create proceeds).

- [ ] **Step 3: Add the guards**

In `createCandidateFromManager`, after the existing `if (!sanitized.name || !sanitized.email) {...}` and the teamLead-derivation block, and before the duplicate-guard, add (mirrors the exact style of the surrounding guards):

```js
    // SP1 — marketing info is hard-required at creation. The sanitizer
    // already validates these enums and enforces the conditional-EAD rule;
    // here we enforce that they are PRESENT. (EAD start/end become required
    // automatically once visaType is set to an EAD-card type — the sanitizer
    // throws for that case.)
    if (!sanitized.visaType) {
      const error = new Error('Visa Type is required'); error.statusCode = 400; throw error;
    }
    if (!sanitized.company) {
      const error = new Error('Company is required'); error.statusCode = 400; throw error;
    }
    if (sanitized.experienceYears === undefined || sanitized.experienceYears === null) {
      const error = new Error('Experience (years) is required'); error.statusCode = 400; throw error;
    }
    if (!sanitized.city) {
      const error = new Error('City is required'); error.statusCode = 400; throw error;
    }
    if (!sanitized.state) {
      const error = new Error('State is required'); error.statusCode = 400; throw error;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- candidateService.createRequired.test.js`
Expected: PASS (all 5 reject cases + the accept case).

- [ ] **Step 5: Run the broader PRT suite to check for regressions**

Run: `cd backend && npm test -- candidateService.prt.test.js`
Expected: PASS (no regression — pre-existing offline DB failures, if any, are unrelated; diff against main if unsure).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/candidateService.js backend/test/candidateService.createRequired.test.js
git commit -m "feat(prt): hard-require visa/company/experience/city/state at candidate creation"
```

---

## Task 4: Worklist HTTP endpoint

**Files:**
- Modify: `backend/src/controllers/candidateController.js` — add `getMarketingInfoWorklist` (mirror `getPOMissingDate` at ~line 336); add `marketingInfoMissingFilter` to the imports from `../models/Candidate.js`.
- Modify: `backend/src/routes/candidates.js` — register the route before `/:id`.
- Test: `backend/test/candidateController.marketingInfoWorklist.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/test/candidateController.marketingInfoWorklist.test.js`. Mock `candidateModel` (collection) so no DB is needed, and drive `_scopeFilter` via the role path (the recruiter branch returns a plain `{ Recruiter: ... }` filter with no async deps, so no extra mocks are needed for it).

> **Important:** importing `candidateController.js` pulls in its other module dependencies (database, userModel, services). If the bare import fails, mirror the `jest.unstable_mockModule(...)` harness from the existing `backend/test/candidateController.attachments.test.js` (or whichever candidateController test exists) — add the same module mocks it uses, then layer the `candidateModel`/`logger` mocks below on top. The assertions stay as written.

```js
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockToArray = jest.fn();
const mockSort = jest.fn(() => ({ limit: () => ({ toArray: mockToArray }) }));
const mockFind = jest.fn(() => ({ sort: mockSort }));
const mockCount = jest.fn();
jest.unstable_mockModule('../src/models/Candidate.js', async () => {
  const actual = await import('../src/models/Candidate.js');
  return {
    ...actual,
    candidateModel: { collection: { find: mockFind, countDocuments: mockCount } },
  };
});
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const { candidateController } = await import('../src/controllers/candidateController.js');

function res() {
  const r = { statusCode: 200, body: undefined };
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((p) => { r.body = p; return r; });
  return r;
}
beforeEach(() => { jest.clearAllMocks(); mockCount.mockResolvedValue(2); mockToArray.mockResolvedValue([
  { _id: { toString: () => 'a1' }, 'Candidate Name': 'Aaa', Recruiter: 'rec@x.com', visaType: '', company: '', updated_at: 1 },
]); });

describe('candidateController.getMarketingInfoWorklist', () => {
  it('403 for a non-marketing role', async () => {
    const r = res();
    await candidateController.getMarketingInfoWorklist({ user: { email: 'e@x.com', role: 'expert' }, query: {} }, r);
    expect(r.statusCode).toBe(403);
  });

  it('401 when unauthenticated', async () => {
    const r = res();
    await candidateController.getMarketingInfoWorklist({ query: {} }, r);
    expect(r.statusCode).toBe(401);
  });

  it('recruiter: returns count + candidates', async () => {
    const r = res();
    await candidateController.getMarketingInfoWorklist({ user: { email: 'rec@x.com', role: 'recruiter' }, query: {} }, r);
    expect(r.body.success).toBe(true);
    expect(r.body.count).toBe(2);
    expect(r.body.candidates[0]).toMatchObject({ id: 'a1', name: 'Aaa' });
    // The query is an $and of [scope, marketingInfoMissingFilter, docType]
    const calledQuery = mockFind.mock.calls[0][0];
    expect(Array.isArray(calledQuery.$and)).toBe(true);
  });

  it('countOnly=1 short-circuits the find', async () => {
    const r = res();
    await candidateController.getMarketingInfoWorklist({ user: { email: 'rec@x.com', role: 'recruiter' }, query: { countOnly: '1' } }, r);
    expect(r.body).toEqual({ success: true, count: 2 });
    expect(mockFind).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- candidateController.marketingInfoWorklist.test.js`
Expected: FAIL — `getMarketingInfoWorklist is not a function`.

- [ ] **Step 3: Implement the controller method + import**

In `backend/src/controllers/candidateController.js`, update the import of `Candidate.js` to include the filter (find the existing `import ... from '../models/Candidate.js'` line and add `marketingInfoMissingFilter`; if the controller imports only `candidateModel`, add a named import):

```js
import { candidateModel, marketingInfoMissingFilter } from '../models/Candidate.js';
```
> If the existing import uses a different specifier/shape, just ensure `marketingInfoMissingFilter` is importable in this file.

Add the method (place it right after `getPOMissingDate`, ~line 368):

```js
  // SP1 — marketing-info worklist. Mirrors getPOMissingDate: role-gated to the
  // marketing roles, scoped via _scopeFilter (which already includes self +
  // hierarchy for every role), filtered by marketingInfoMissingFilter().
  async getMarketingInfoWorklist(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

      const normalizedRole = (user.role || '').trim().toLowerCase();
      if (!['admin', 'mam', 'mm', 'mlead', 'recruiter'].includes(normalizedRole)) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }

      const col = candidateModel.collection;
      if (!col) return res.status(503).json({ success: false, error: 'Database not ready' });

      const scope = await this._scopeFilter(user);
      const query = { $and: [scope, marketingInfoMissingFilter(), { docType: { $in: [null, 'candidate'] } }] };

      const count = await col.countDocuments(query);
      if (req.query.countOnly === '1' || req.query.countOnly === 'true') {
        return res.json({ success: true, count });
      }

      const docs = await col.find(query, {
        projection: {
          _id: 1, 'Candidate Name': 1, Recruiter: 1,
          visaType: 1, company: 1, eadStartDate: 1, eadEndDate: 1, updated_at: 1,
        },
      }).sort({ updated_at: -1 }).limit(500).toArray();

      return res.json({
        success: true,
        count,
        returned: docs.length,
        candidates: docs.map((d) => ({
          id: d._id.toString(),
          name: d['Candidate Name'] || '',
          recruiter: d.Recruiter || '',
          visaType: d.visaType || '',
          company: d.company || '',
          eadStartDate: d.eadStartDate || null,
          eadEndDate: d.eadEndDate || null,
          updatedAt: d.updated_at,
        })),
      });
    } catch (error) {
      logger.error('getMarketingInfoWorklist failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
```

- [ ] **Step 4: Register the route**

In `backend/src/routes/candidates.js`, add immediately after the `/po-missing-date` route (~line 71), well before the generic `/:id` route:

```js
router.get('/marketing-info-worklist', (req, res) =>
  candidateController.getMarketingInfoWorklist(req, res)
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- candidateController.marketingInfoWorklist.test.js`
Expected: PASS (401/403/recruiter/countOnly).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/candidateController.js backend/src/routes/candidates.js backend/test/candidateController.marketingInfoWorklist.test.js
git commit -m "feat(prt): GET /api/candidates/marketing-info-worklist (scoped, count + list)"
```

---

## Task 5: Make create-form fields required (frontend)

**Files:**
- Modify: `frontend/src/components/dashboard/BranchCandidates.tsx` — the Add-Candidate submit handler (the one that appends `additionalFiles` to FormData, ~lines 1977/2028) and its validation block.

> Read the create-candidate submit handler region first (search for where `experienceYears`/`visaType`/`company` form state is read and where `setError(...)` is called for the create form). Mirror the existing `setError('… is required'); return;` validation style already used for the assessment/support forms (e.g. lines ~1636–1925).

- [ ] **Step 1: Add client validation (no test framework step — gated by tsc + manual)**

In the create-candidate submit handler, before building the request, add guards mirroring the existing pattern. Use the existing create-form state object (the one holding `visaType`, `company`, `experienceYears`, `eadStartDate`, `eadEndDate`, and city/state). Example shape (adapt identifiers to the actual state variable names in the file):

```ts
    if (!form.visaType) { setError('Visa Type is required.'); return; }
    if (!form.company) { setError('Company is required.'); return; }
    if (!form.experienceYears && form.experienceYears !== 0) { setError('Experience (years) is required.'); return; }
    if (!form.city?.trim()) { setError('City is required.'); return; }
    if (!form.state?.trim()) { setError('State is required.'); return; }
    const EAD_TYPES = ['OPT', 'STEM OPT', 'CPT', 'Day 1 CPT', 'H4-EAD', 'L2'];
    if (EAD_TYPES.includes(form.visaType)) {
      if (!form.eadStartDate) { setError('EAD start date is required for this visa type.'); return; }
      if (!form.eadEndDate) { setError('EAD end date is required for this visa type.'); return; }
    }
    // NOTE: additional attachments remain OPTIONAL — do not validate additionalFiles.
```

Also mark the corresponding inputs visually required (add `required` / an asterisk to the labels) so the UI communicates the requirement. Resume is already required by the existing flow — leave it as-is.

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 3: Manual smoke (document, don't skip)**

Open the Add-Candidate form, leave Visa Type blank → submit is blocked with "Visa Type is required." Choose `OPT` → EAD start/end become required. Fill everything except an additional attachment → submit succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/dashboard/BranchCandidates.tsx
git commit -m "feat(prt): require visa/EAD/company/experience/city/state in the create form"
```

---

## Task 6: `MarketingInfoModal` (frontend)

**Files:**
- Create: `frontend/src/components/dashboard/MarketingInfoModal.tsx`
- Test: `frontend/src/components/dashboard/__tests__/MarketingInfoModal.test.tsx`

> Mirror an existing dialog for structure (e.g. `AssignmentEmailModal.tsx` from P3, or another shadcn `Dialog` in the dashboard). Reuse the SAME visa/company option arrays the create form uses (extract them to a shared const if they're currently inline in BranchCandidates, or re-declare the small arrays locally — keep them identical to `VISA_TYPE_VALUES`/`COMPANY_VALUES`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/dashboard/__tests__/MarketingInfoModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarketingInfoModal } from '../MarketingInfoModal';

describe('MarketingInfoModal', () => {
  it('shows EAD date fields only for EAD-card visa types', () => {
    const { rerender } = render(
      <MarketingInfoModal open candidateId="x" initial={{ visaType: 'H1B', company: '', eadStartDate: null, eadEndDate: null }} onOpenChange={() => {}} onSaved={() => {}} />
    );
    expect(screen.queryByLabelText(/EAD start/i)).toBeNull();

    rerender(
      <MarketingInfoModal open candidateId="x" initial={{ visaType: 'OPT', company: '', eadStartDate: null, eadEndDate: null }} onOpenChange={() => {}} onSaved={() => {}} />
    );
    expect(screen.getByLabelText(/EAD start/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/dashboard/__tests__/MarketingInfoModal.test.tsx`
Expected: FAIL — cannot find module `../MarketingInfoModal`.

- [ ] **Step 3: Implement the modal**

Create `frontend/src/components/dashboard/MarketingInfoModal.tsx`. Use the shadcn `Dialog`, `Select`, and date inputs already used elsewhere in the dashboard. Save via `authFetch` (from `useAuth`) to the existing candidate update endpoint, parsing with `parseJsonOrThrow`:

```tsx
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { parseJsonOrThrow } from '@/lib/fetchJson';

const VISA_TYPE_VALUES = ['OPT','L2','Green Card','STEM OPT','USC','H4-EAD','PR','CPT','H1B','Day 1 CPT','Asylum'];
const COMPANY_VALUES = ['SST','VCS','FED'];
const EAD_TYPES = ['OPT','STEM OPT','CPT','Day 1 CPT','H4-EAD','L2'];

export interface MarketingInfoModalProps {
  open: boolean;
  candidateId: string;
  initial: { visaType: string; company: string; eadStartDate: string | null; eadEndDate: string | null };
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export function MarketingInfoModal({ open, candidateId, initial, onOpenChange, onSaved }: MarketingInfoModalProps) {
  const { authFetch } = useAuth();
  const [visaType, setVisaType] = useState(initial.visaType || '');
  const [company, setCompany] = useState(initial.company || '');
  const [eadStartDate, setEadStartDate] = useState(initial.eadStartDate || '');
  const [eadEndDate, setEadEndDate] = useState(initial.eadEndDate || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const needsEad = EAD_TYPES.includes(visaType);

  const save = async () => {
    setError('');
    if (!visaType) return setError('Visa Type is required.');
    if (!company) return setError('Company is required.');
    if (needsEad && (!eadStartDate || !eadEndDate)) return setError('EAD start and end dates are required for this visa type.');
    setSaving(true);
    try {
      const body: Record<string, unknown> = { visaType, company };
      if (needsEad) { body.eadStartDate = eadStartDate; body.eadEndDate = eadEndDate; }
      const res = await authFetch(`/api/candidates/${candidateId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      await parseJsonOrThrow(res);
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Marketing info</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="mi-visa">Visa Type</Label>
            <Select value={visaType} onValueChange={setVisaType}>
              <SelectTrigger id="mi-visa"><SelectValue placeholder="Select visa type" /></SelectTrigger>
              <SelectContent>{VISA_TYPE_VALUES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {needsEad && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="mi-ead-start">EAD start</Label>
                <Input id="mi-ead-start" type="date" value={eadStartDate} onChange={(e) => setEadStartDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="mi-ead-end">EAD end</Label>
                <Input id="mi-ead-end" type="date" value={eadEndDate} onChange={(e) => setEadEndDate(e.target.value)} />
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="mi-company">Company</Label>
            <Select value={company} onValueChange={setCompany}>
              <SelectTrigger id="mi-company"><SelectValue placeholder="Select company" /></SelectTrigger>
              <SelectContent>{COMPANY_VALUES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

> Verify the candidate update endpoint + verb. If the existing edit path uses `PUT /api/candidates/:id` or a different shape, match it (search BranchCandidates/CandidateDetailPage for how an existing field edit is persisted) — keep the PRT-write contract identical to what P1d already accepts.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/dashboard/__tests__/MarketingInfoModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/dashboard/MarketingInfoModal.tsx frontend/src/components/dashboard/__tests__/MarketingInfoModal.test.tsx
git commit -m "feat(prt): MarketingInfoModal to fill visa/EAD/company on existing candidates"
```

---

## Task 7: Branch Candidates — badge, filter, count, modal wiring

**Files:**
- Modify: `frontend/src/components/dashboard/BranchCandidates.tsx`

> **Deviation from spec §3d (intentional):** the spec proposed a *standalone* "Marketing Info Needed" page + sidebar nav badge. We consolidate that into the existing **Branch Candidates marketing view** (badge + filter chip + header count) backed by the `/marketing-info-worklist` endpoint. Rationale: Branch Candidates is already the role-scoped marketing view ("pop up in the marketing team view"), the sidebar count badges are socket-based (adding one HTTP badge there is inconsistent), and the filter chip already gives "the list of these candidates." No standalone page/route or sidebar change is added.

> The candidate records this view already renders now carry `needsMarketingInfo: boolean` and `missingMarketingFields: string[]` (Task 2). No new fetch is needed for the per-row badge. The cross-scope count uses the worklist endpoint's `countOnly`.

> **Completeness caveat (no silent cap):** first check whether this view loads ALL of the viewer's scoped candidates or is **server-paginated**. If it loads all → a client-side filter on `needsMarketingInfo` is complete. If it is **paginated** → a client-side filter would silently miss needs-info candidates on unloaded pages; in that case the filter chip MUST instead fetch the authoritative list from `GET /api/candidates/marketing-info-worklist` (server-filtered, up to 500) and render that. Pick the correct option based on what the file actually does, and note the choice in the commit message.

- [ ] **Step 1: Per-row "Needs info" badge**

In the candidate row/card rendering, when `candidate.needsMarketingInfo` is true, render a `Badge variant="destructive"` (or amber) labelled "Needs info", with a tooltip/title listing `candidate.missingMarketingFields`. Clicking it (or a row action) opens `MarketingInfoModal` for that candidate.

```tsx
{candidate.needsMarketingInfo && (
  <Badge
    variant="destructive"
    className="cursor-pointer"
    title={`Missing: ${(candidate.missingMarketingFields || []).join(', ')}`}
    onClick={() => setMarketingInfoFor(candidate)}
  >
    Needs info
  </Badge>
)}
```

Add state + render the modal once at the component root:

```tsx
const [marketingInfoFor, setMarketingInfoFor] = useState<null | { id: string; visaType?: string; company?: string; eadStartDate?: string | null; eadEndDate?: string | null }>(null);
// ...
{marketingInfoFor && (
  <MarketingInfoModal
    open={!!marketingInfoFor}
    candidateId={marketingInfoFor.id}
    initial={{
      visaType: marketingInfoFor.visaType || '',
      company: marketingInfoFor.company || '',
      eadStartDate: marketingInfoFor.eadStartDate || null,
      eadEndDate: marketingInfoFor.eadEndDate || null,
    }}
    onOpenChange={(o) => { if (!o) setMarketingInfoFor(null); }}
    onSaved={() => { /* refetch the candidate list (call the existing refresh fn) */ }}
  />
)}
```

Wire `onSaved` to the existing list-refresh function used elsewhere in this component after an edit.

- [ ] **Step 2: Filter chip**

Add a "Needs marketing info" toggle to the existing filter UI. When active, filter the rendered list to `candidate.needsMarketingInfo === true` (client-side, mirroring how the existing status/visa filter chips narrow the list).

- [ ] **Step 3: Count indicator**

Near the page/section header, fetch and show the accurate scoped count:

```tsx
const [needsInfoCount, setNeedsInfoCount] = useState<number | null>(null);
useEffect(() => {
  let cancelled = false;
  authFetch('/api/candidates/marketing-info-worklist?countOnly=1')
    .then((r) => parseJsonOrThrow<{ count: number }>(r))
    .then((d) => { if (!cancelled) setNeedsInfoCount(d.count); })
    .catch(() => { if (!cancelled) setNeedsInfoCount(null); });
  return () => { cancelled = true; };
}, [/* re-run when the list refreshes */]);
// render: {needsInfoCount ? <span>{needsInfoCount} candidate(s) need marketing info</span> : null}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual smoke**

As a recruiter with an info-missing candidate: the badge shows; clicking opens the modal; saving visa+company (and EAD if prompted) removes the badge after refresh; the filter chip shows only needs-info rows; the header count matches.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/dashboard/BranchCandidates.tsx
git commit -m "feat(prt): surface needs-marketing-info badge, filter, and count in Branch Candidates"
```

---

## Task 8: Full verification + PR

- [ ] **Step 1: Backend tests**

Run: `cd backend && npm test -- candidate.marketingInfo.test.js candidateService.createRequired.test.js candidateController.marketingInfoWorklist.test.js`
Expected: all PASS.

- [ ] **Step 2: Frontend checks**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/components/dashboard/__tests__/MarketingInfoModal.test.tsx`
Expected: PASS. Optionally `cd frontend && npm run build` to confirm the production build is clean.

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin feat/sp1-visa-marketing-info
gh pr create --base main --title "feat(prt): SP1 — marketing-info capture (required at create + needs-info worklist)" --body "<summary; NO AI-attribution trailer>"
```

PR body covers: create-time requiredness (visa/company/experience/city/state; EAD auto via sanitizer), the `needsMarketingInfo` flag (stripped for non-marketing), the scoped `/marketing-info-worklist` endpoint (mirrors getPOMissingDate + _scopeFilter), and the Branch Candidates badge/filter/count + MarketingInfoModal. Note: no assign-to-expert gate; no backfill.

- [ ] **Step 4: Wait for CI; fix any failures; report PR URL.**

---

## Out of scope (separate sub-projects)
- **SP6** — generalized CRUD audit logging (candidate `editHistory` already exists).
- **SP7** — Nikita read-only view for Tasks + Branch Candidates.
- **SP2** (next after SP1) — meeting-started + Technical-Team acknowledgment email (Harsh Patel signature).
- Resume backfill for existing candidates.
