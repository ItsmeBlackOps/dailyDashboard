# C20 Phase 2 — Team-Scoped Hierarchy Walks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two hierarchy walks respect `team` (strict same-team), so a requester can no longer reach users/candidates on another team via the `teamLead` name-chain — while leaving C19 delegations cross-team and never locking anyone out.

**Architecture:** One exported pure predicate `teamScopeDecision(requesterTeam, targetTeam)` is the single source of truth for the rule (fail-open on missing team). Both walks — `userService.isUserInRequesterHierarchy` and `candidateService.collectHierarchyEmails` — resolve the requester's team from the live `getAllUsers()` snapshot and apply the predicate inline in the report loop, gating **both inclusion and traversal**, on the **own-subtree walk only** (delegation unions pass `enforceTeam = false`). Straggler (missing-team) cases fall back to today's behavior and emit a deduped warning.

**Tech Stack:** Node ESM, raw `mongodb` driver, Jest with `--experimental-vm-modules`. Backend only. Spec: `docs/superpowers/specs/2026-06-08-c20-phase2-team-scoped-bfs-design.md`.

---

## File Structure

- **`backend/src/services/userService.js`** (modify) — add the exported `teamScopeDecision` predicate + `emitTeamStragglerWarning` (module scope, near `emitLegacyRoleWarning` ~line 84); team-scope the `isUserInRequesterHierarchy` own-subtree walk (~lines 541–607).
- **`backend/src/services/candidateService.js`** (modify) — import the two helpers from `userService.js` (extend the existing import at line 52); team-scope the `collectHierarchyEmails` own-subtree walk (~lines 290–375).
- **`backend/test/userService.teamScopedHierarchy.test.js`** (create) — unit tests for `teamScopeDecision` + `isUserInRequesterHierarchy`.
- **`backend/test/candidateService.teamScopedHierarchy.test.js`** (create) — tests for `collectHierarchyEmails`.

All test commands run from the `backend/` directory: `npm test` is Jest with experimental ESM; a single file is `npm test -- test/<file>.test.js`.

**Key facts about the code you are touching (already verified):**
- `userService.js` module scope already has `const VALID_TEAMS = new Set(['technical','marketing','sales'])` (line 39), `const emitLegacyRoleWarning = (role, source) => {…}` (line 84), and imports `logger`.
- `isUserInRequesterHierarchy(requester, targetEmail)` (line 541) builds `leadToUsers` from `this.userModel.getAllUsers()` (line 547), defines `bfsContains(rootDisplayName)` (line 559), calls it for the own root at line 580 (`bfsContains(ownRoot)`) and for delegation subtree roots at line 595 (`bfsContains(rootDisplay)`). It reads each report as `r`, with `r.email` and (new) `r.team`. Display names come from `this.normalizeNameValue(this.deriveDisplayNameFromEmail(...))`.
- `candidateService.js` imports at line 52: `import { userService, roleLevel } from './userService.js';`. Module-scope helpers `normalizeEmail` (line 83), `deriveDisplayNameFromEmail` (line 92), `normalizeName` (line 99). `collectHierarchyEmails(user)` (line 290) builds `leadToUsers` from `userModel.getAllUsers()` (line 291), defines `walkSubtree(rootDisplayName)` (line 311), calls it for the own root at line 334 and for delegation subtree roots at line 362. Each report is `report`, with `report.email`, `report.role`, and (new) `report.team`.
- Both walks lazy-`import('./delegationService.js')` and call `delegationService.listActiveForUser(email)` inside a try/catch that falls back to the own-subtree result on error.
- Test harness pattern (from `backend/test/candidateService.adminView.test.js`): import the real singletons, monkey-patch `userModel.getAllUsers = jest.fn().mockReturnValue([...])`, restore in `afterEach`. The dynamic `delegationService` import resolves to the `delegationService` singleton, so patching `delegationService.listActiveForUser` works.

---

### Task 1: Add `teamScopeDecision` predicate + `emitTeamStragglerWarning`

**Files:**
- Create: `backend/test/userService.teamScopedHierarchy.test.js`
- Modify: `backend/src/services/userService.js` (insert after line 88, right after `emitLegacyRoleWarning`)

- [ ] **Step 1: Write the failing test** (create `backend/test/userService.teamScopedHierarchy.test.js` with just the predicate block for now)

```js
import { describe, it, expect } from '@jest/globals';
import { teamScopeDecision } from '../src/services/userService.js';

describe('teamScopeDecision', () => {
  it('requester with no team → fail-open (allowed, not straggler)', () => {
    expect(teamScopeDecision(null, 'marketing')).toEqual({ allowed: true, straggler: false });
    expect(teamScopeDecision('', 'technical')).toEqual({ allowed: true, straggler: false });
  });

  it('target with no team → fail-open + straggler', () => {
    expect(teamScopeDecision('marketing', null)).toEqual({ allowed: true, straggler: true });
    expect(teamScopeDecision('marketing', '')).toEqual({ allowed: true, straggler: true });
  });

  it('both teamed, same team → allowed', () => {
    expect(teamScopeDecision('marketing', 'marketing')).toEqual({ allowed: true, straggler: false });
  });

  it('both teamed, different team → not allowed', () => {
    expect(teamScopeDecision('marketing', 'technical')).toEqual({ allowed: false, straggler: false });
  });

  it('normalizes case and whitespace', () => {
    expect(teamScopeDecision('  Marketing ', 'MARKETING').allowed).toBe(true);
    expect(teamScopeDecision('Technical', ' marketing ').allowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- test/userService.teamScopedHierarchy.test.js`
Expected: FAIL — `teamScopeDecision is not a function` (not yet exported).

- [ ] **Step 3: Implement the predicate + straggler warning** in `backend/src/services/userService.js`, inserted immediately after the `emitLegacyRoleWarning` block (after line 88):

```js
// C20 phase 2 — team-scoping for the hierarchy walks. The single source of
// truth for the same-team rule. Fail-open: a missing team on either side never
// removes access (it falls back to the name-chain result) — scoping only ever
// removes a *clearly* cross-team edge (both sides teamed, teams differ).
export const teamScopeDecision = (requesterTeam, targetTeam) => {
  const a = (requesterTeam || '').toString().toLowerCase().trim() || null;
  const b = (targetTeam || '').toString().toLowerCase().trim() || null;
  if (!a) return { allowed: true, straggler: false }; // requester un-teamed (incl. admins)
  if (!b) return { allowed: true, straggler: true };  // target un-teamed → fall back + warn
  return { allowed: a === b, straggler: false };
};

// Deduped straggler warning — one log per (source, email) for the process
// lifetime, so a large un-migrated cohort doesn't spam the logs.
const _teamStragglerWarned = new Set();
export const emitTeamStragglerWarning = (email, source) => {
  const key = `${source}:${(email || '').toString().toLowerCase().trim()}`;
  if (_teamStragglerWarned.has(key)) return;
  _teamStragglerWarned.add(key);
  logger.warn('team-scope straggler: record has no team; falling back to name-chain', { email, source });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- test/userService.teamScopedHierarchy.test.js`
Expected: PASS (5 tests in the `teamScopeDecision` describe block).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/userService.js backend/test/userService.teamScopedHierarchy.test.js
git commit -m "feat(c20): teamScopeDecision predicate + straggler warning (phase 2)"
```

---

### Task 2: Team-scope `isUserInRequesterHierarchy`

**Files:**
- Modify: `backend/src/services/userService.js` (`isUserInRequesterHierarchy`, ~lines 541–607)
- Test: `backend/test/userService.teamScopedHierarchy.test.js` (add a second describe block)

- [ ] **Step 1: Write the failing tests** — append this describe block to `backend/test/userService.teamScopedHierarchy.test.js`:

```js
import { jest, afterEach, beforeEach } from '@jest/globals';
import { userService } from '../src/services/userService.js';
import { userModel } from '../src/models/User.js';
import { delegationService } from '../src/services/delegationService.js';
import { logger } from '../src/utils/logger.js';

const origGetAllUsers = userModel.getAllUsers;
const origListActive = delegationService.listActiveForUser;

afterEach(() => {
  userModel.getAllUsers = origGetAllUsers;
  delegationService.listActiveForUser = origListActive;
  jest.restoreAllMocks();
});

beforeEach(() => {
  // No delegations by default — isolate the own-subtree team scoping.
  delegationService.listActiveForUser = jest.fn().mockResolvedValue([]);
});

// Requester "mlead@example.com" → derived display name "Mlead". Reports point
// teamLead at "Mlead". deriveDisplayNameFromEmail('mlead@...') === 'Mlead'.
const marketingLead = { email: 'mlead@example.com', role: 'mlead', team: 'marketing' };
const sameTeamRec = { email: 'rec.same@example.com', role: 'recruiter', team: 'marketing', teamLead: 'Mlead' };
const crossTeamRec = { email: 'rec.cross@example.com', role: 'recruiter', team: 'technical', teamLead: 'Mlead' };
const noTeamRec = { email: 'rec.noteam@example.com', role: 'recruiter', teamLead: 'Mlead' };

describe('isUserInRequesterHierarchy — team scoping', () => {
  it('includes a same-team direct report', async () => {
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, sameTeamRec, crossTeamRec]);
    const result = await userService.isUserInRequesterHierarchy({ email: 'mlead@example.com' }, 'rec.same@example.com');
    expect(result).toBe(true);
  });

  it('excludes a cross-team report even though its teamLead points at the requester', async () => {
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, sameTeamRec, crossTeamRec]);
    const result = await userService.isUserInRequesterHierarchy({ email: 'mlead@example.com' }, 'rec.cross@example.com');
    expect(result).toBe(false);
  });

  it('fail-open: target with no team is still included + warns', async () => {
    const warnSpy = jest.spyOn(logger, 'warn');
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, noTeamRec]);
    const result = await userService.isUserInRequesterHierarchy({ email: 'mlead@example.com' }, 'rec.noteam@example.com');
    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('team-scope straggler'),
      expect.objectContaining({ email: 'rec.noteam@example.com' }),
    );
  });

  it('fail-open: requester with no team falls back to old behavior (cross-team reachable)', async () => {
    const noTeamLead = { ...marketingLead, team: undefined };
    userModel.getAllUsers = jest.fn().mockReturnValue([noTeamLead, crossTeamRec]);
    const result = await userService.isUserInRequesterHierarchy({ email: 'mlead@example.com' }, 'rec.cross@example.com');
    expect(result).toBe(true);
  });

  it('C19 delegation to a cross-team user still resolves true (delegations are not team-gated)', async () => {
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, crossTeamRec]);
    delegationService.listActiveForUser = jest.fn().mockResolvedValue([
      { scope: 'specific', subjectEmails: ['rec.cross@example.com'] },
    ]);
    const result = await userService.isUserInRequesterHierarchy({ email: 'mlead@example.com' }, 'rec.cross@example.com');
    expect(result).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- test/userService.teamScopedHierarchy.test.js`
Expected: FAIL — the "excludes a cross-team report" test fails (currently returns `true`, because the walk is team-blind). The same-team and delegation tests may already pass; the cross-team and straggler-warn tests fail.

- [ ] **Step 3: Implement the team gate** in `backend/src/services/userService.js`.

(3a) Resolve the requester's team from the snapshot. Immediately after `const allUsers = this.userModel.getAllUsers();` (line 547) — before the `leadToUsers` build — add:

```js
    const selfRecord = allUsers.find(
      (u) => (u.email || '').toString().toLowerCase().trim() === requesterEmail,
    );
    const requesterTeam = selfRecord?.team ?? null;
```

(3b) Replace the `bfsContains` definition (lines 559–576) with a team-aware version that takes an `enforceTeam` flag and gates inclusion **and** traversal:

```js
    const bfsContains = (rootDisplayName, enforceTeam) => {
      if (!rootDisplayName) return false;
      const visited = new Set();
      const queue = [rootDisplayName];
      while (queue.length > 0) {
        const cur = queue.shift();
        if (!cur || visited.has(cur)) continue;
        visited.add(cur);
        const directs = leadToUsers.get(cur) || [];
        for (const r of directs) {
          if (enforceTeam) {
            const { allowed, straggler } = teamScopeDecision(requesterTeam, r.team);
            if (straggler) emitTeamStragglerWarning(r.email, 'isUserInRequesterHierarchy');
            if (!allowed) continue; // cross-team: do not include and do not traverse through
          }
          const rEmail = (r.email || '').toLowerCase().trim();
          if (rEmail === target) return true;
          const rDisplay = this.normalizeNameValue(this.deriveDisplayNameFromEmail(r.email));
          if (rDisplay && !visited.has(rDisplay)) queue.push(rDisplay);
        }
      }
      return false;
    };
```

(3c) Update the two call sites. Own subtree (line 580) → `if (bfsContains(ownRoot, true)) return true;`. Delegation subtree (line 595) → `if (bfsContains(rootDisplay, false)) return true;`.

`teamScopeDecision` and `emitTeamStragglerWarning` are module-scoped in this same file (Task 1), so they are directly in scope here.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- test/userService.teamScopedHierarchy.test.js`
Expected: PASS (all tests, both describe blocks).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/userService.js backend/test/userService.teamScopedHierarchy.test.js
git commit -m "feat(c20): team-scope isUserInRequesterHierarchy own-subtree walk (phase 2)"
```

---

### Task 3: Team-scope `candidateService.collectHierarchyEmails`

**Files:**
- Modify: `backend/src/services/candidateService.js` (import line 52; `collectHierarchyEmails`, ~lines 290–375)
- Test: `backend/test/candidateService.teamScopedHierarchy.test.js` (create)

- [ ] **Step 1: Write the failing tests** — create `backend/test/candidateService.teamScopedHierarchy.test.js`:

```js
import { describe, it, expect, jest, afterEach, beforeEach } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { userModel } from '../src/models/User.js';
import { delegationService } from '../src/services/delegationService.js';
import { logger } from '../src/utils/logger.js';

const origGetAllUsers = userModel.getAllUsers;
const origListActive = delegationService.listActiveForUser;

afterEach(() => {
  userModel.getAllUsers = origGetAllUsers;
  delegationService.listActiveForUser = origListActive;
  jest.restoreAllMocks();
});

beforeEach(() => {
  delegationService.listActiveForUser = jest.fn().mockResolvedValue([]);
});

const marketingLead = { email: 'mlead@example.com', role: 'mlead', team: 'marketing' };
const sameTeamRec = { email: 'rec.same@example.com', role: 'recruiter', team: 'marketing', teamLead: 'Mlead' };
const crossTeamRec = { email: 'rec.cross@example.com', role: 'recruiter', team: 'technical', teamLead: 'Mlead' };
const noTeamRec = { email: 'rec.noteam@example.com', role: 'recruiter', teamLead: 'Mlead' };

describe('collectHierarchyEmails — team scoping', () => {
  it('includes a same-team recruiter in both sets', async () => {
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, sameTeamRec, crossTeamRec]);
    const { allSubordinateEmails, recruiterEmails } = await candidateService.collectHierarchyEmails(marketingLead);
    expect(allSubordinateEmails.has('rec.same@example.com')).toBe(true);
    expect(recruiterEmails.has('rec.same@example.com')).toBe(true);
  });

  it('excludes a cross-team recruiter from both sets', async () => {
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, sameTeamRec, crossTeamRec]);
    const { allSubordinateEmails, recruiterEmails } = await candidateService.collectHierarchyEmails(marketingLead);
    expect(allSubordinateEmails.has('rec.cross@example.com')).toBe(false);
    expect(recruiterEmails.has('rec.cross@example.com')).toBe(false);
  });

  it('fail-open: recruiter with no team is included + warns', async () => {
    const warnSpy = jest.spyOn(logger, 'warn');
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, noTeamRec]);
    const { allSubordinateEmails } = await candidateService.collectHierarchyEmails(marketingLead);
    expect(allSubordinateEmails.has('rec.noteam@example.com')).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('team-scope straggler'),
      expect.objectContaining({ email: 'rec.noteam@example.com' }),
    );
  });

  it('fail-open: requester with no team falls back (cross-team included)', async () => {
    const noTeamLead = { ...marketingLead, team: undefined };
    userModel.getAllUsers = jest.fn().mockReturnValue([noTeamLead, crossTeamRec]);
    const { allSubordinateEmails } = await candidateService.collectHierarchyEmails({ email: 'mlead@example.com', role: 'mlead' });
    expect(allSubordinateEmails.has('rec.cross@example.com')).toBe(true);
  });

  it('C19 specific delegation to a cross-team user is still included', async () => {
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, crossTeamRec]);
    delegationService.listActiveForUser = jest.fn().mockResolvedValue([
      { scope: 'specific', subjectEmails: ['rec.cross@example.com'] },
    ]);
    const { allSubordinateEmails, recruiterEmails } = await candidateService.collectHierarchyEmails(marketingLead);
    expect(allSubordinateEmails.has('rec.cross@example.com')).toBe(true);
    expect(recruiterEmails.has('rec.cross@example.com')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- test/candidateService.teamScopedHierarchy.test.js`
Expected: FAIL — "excludes a cross-team recruiter" fails (currently included, walk is team-blind) and the straggler-warn test fails.

- [ ] **Step 3: Implement the team gate** in `backend/src/services/candidateService.js`.

(3a) Extend the import at line 52:

```js
import { userService, roleLevel, teamScopeDecision, emitTeamStragglerWarning } from './userService.js';
```

(3b) Resolve requester team from the snapshot. Immediately after `const allUsers = userModel.getAllUsers();` (line 291) add:

```js
    const selfRecord = allUsers.find(
      (u) => normalizeEmail(u.email) === normalizeEmail(user.email),
    );
    const requesterTeam = selfRecord?.team ?? null;
```

(3c) Replace the `walkSubtree` definition (lines 311–331) with a team-aware version:

```js
    const walkSubtree = (rootDisplayName, enforceTeam) => {
      if (!rootDisplayName) return;
      const visitedLeads = new Set();
      const queue = [rootDisplayName];
      while (queue.length > 0) {
        const currentLead = queue.shift();
        if (!currentLead || visitedLeads.has(currentLead)) continue;
        visitedLeads.add(currentLead);
        const directReports = leadToUsers.get(currentLead) || [];
        for (const report of directReports) {
          if (enforceTeam) {
            const { allowed, straggler } = teamScopeDecision(requesterTeam, report.team);
            if (straggler) emitTeamStragglerWarning(report.email, 'collectHierarchyEmails');
            if (!allowed) continue; // cross-team: do not include and do not traverse through
          }
          const reportEmail = normalizeEmail(report.email);
          if (reportEmail) allSubordinateEmails.add(reportEmail);
          const reportRole = (report.role || '').toLowerCase();
          if (reportRole === 'recruiter') recruiterEmails.add(reportEmail);
          const reportDisplayName = normalizeName(deriveDisplayNameFromEmail(report.email));
          if (reportDisplayName && !visitedLeads.has(reportDisplayName)) {
            queue.push(reportDisplayName);
          }
        }
      }
    };
```

(3d) Update the two call sites. Own subtree (line 334) → `walkSubtree(normalizeName(deriveDisplayNameFromEmail(user.email)), true);`. Delegation subtree (line 362) → `walkSubtree(rootDisplay, false);`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- test/candidateService.teamScopedHierarchy.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/candidateService.js backend/test/candidateService.teamScopedHierarchy.test.js
git commit -m "feat(c20): team-scope collectHierarchyEmails own-subtree walk (phase 2)"
```

---

### Task 4: Callers audit + full-suite verification

**Files:** none modified (verification + a short audit note appended to the PR body).

- [ ] **Step 1: List every caller of both walks** so we know exactly which surfaces tighten.

Run: `cd backend && grep -rn "isUserInRequesterHierarchy\|collectHierarchyEmails" src/`
Expected callers (confirm each is an intended same-team surface; none should be an admin/global path that must stay unscoped — admins already fail-open via null team):
- `isUserInRequesterHierarchy` → `src/controllers/userController.js:149` (profile read, C8/C19).
- `collectHierarchyEmails` → `src/services/candidateService.js` candidate-scope resolution (e.g. the `getCandidatesForUser` non-admin branch, ~line 1247).

Write a 3–5 line summary of the caller list into the PR description under a "Callers audited" heading. If any caller is a path that intentionally needs cross-team visibility for a non-admin (none expected), STOP and raise it — do not silently scope it.

- [ ] **Step 2: Confirm admins/managers are unaffected by re-reading the gates above the BFS.**

Run: `cd backend && grep -n "canManageUsers\|=== 'admin'" src/services/userService.js src/controllers/userController.js`
Expected: admin/`canManageUsers` short-circuits sit above or independent of the BFS, and admins have `team = null` → `teamScopeDecision` returns `allowed:true`. Note this in the PR body (one line). No code change.

- [ ] **Step 3: Run the full backend test suite.**

Run: `cd backend && npm test`
Expected: PASS, except the **pre-existing** failures called out in CLAUDE.md §2 (`userService.nameFormatting.test.js`, `userService.test.js` mock-incompleteness) and any suite that needs a live Atlas connection (`querySrv ECONNREFUSED` offline). Diff against `main` if unsure — your changes must not introduce *new* failures. The two new test files must pass.

- [ ] **Step 4: Commit (if any audit notes were added to tracked files) and open the PR.**

```bash
git push -u origin feat/c20-phase2-team-scoped-bfs
gh pr create --title "feat(c20): phase 2 — team-scoped hierarchy walks" --body "Implements docs/superpowers/specs/2026-06-08-c20-phase2-team-scoped-bfs-design.md. Strict same-team scoping of both hierarchy walks (fail-open + warn on missing team); C19 delegations stay cross-team. Includes the callers-audit summary."
```

Expected: PR opens; CI (Backend + Frontend Tests) runs green.

---

## Self-Review

**1. Spec coverage:**
- Shared `teamScopeDecision` predicate (single source of truth) → Task 1. ✓
- `emitTeamStragglerWarning` (deduped) → Task 1. ✓
- Team-scope `isUserInRequesterHierarchy`, own-subtree only, gate inclusion + traversal, requester team from snapshot → Task 2. ✓
- Team-scope `collectHierarchyEmails`, same → Task 3. ✓
- Delegations stay cross-team (`enforceTeam = false`) → Tasks 2 & 3 (call sites + delegation tests). ✓
- Fail-open on null requester / null target → Tasks 2 & 3 tests. ✓
- Admins unaffected → Task 4 Step 2 (verified; null-team fail-open). ✓
- Callers audit (incl. `GET /users/manageable` path) → Task 4 Step 1. ✓
- Test matrix (same / cross / null-requester / null-target / delegation specific + subtree) → covered; note `subtree`-delegation cross-team is implicitly covered by the `enforceTeam=false` call-site change and the `specific`-delegation test. If the reviewer wants an explicit `subtree` delegation test, add one mirroring the `specific` case with `{ scope: 'subtree', subtreeRootEmail: 'rec.cross@example.com' }`.

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows the assertions; every run step shows the command + expected result. ✓

**3. Type consistency:** `teamScopeDecision(requesterTeam, targetTeam) → { allowed, straggler }` and `emitTeamStragglerWarning(email, source)` are used with identical signatures in Tasks 1, 2, and 3. The `enforceTeam` boolean flag name is consistent across `bfsContains` and `walkSubtree`. `requesterTeam`/`selfRecord` names are consistent. ✓

**Out of scope (do NOT implement):** frontend rename, running/verifying the migration, the fail-closed flip.
