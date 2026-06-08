# C20 Phase 2 — Team-Scoped Hierarchy Walks — Design

> Date: 2026-06-08. Scope: **backend only**. Branch (impl): TBD `feat/c20-phase2-team-scoped-bfs`.
> Status: design approved; implementation deferred to a separate writing-plans pass.

## Problem

The two hierarchy walks that decide "whose records can this user see" are **team-blind**. Both
traverse a `teamLead` **display-name** chain with no reference to the `team` field:

- `userService.isUserInRequesterHierarchy(requester, targetEmail)` (`backend/src/services/userService.js:541`)
  — boolean reachability over a `teamLeadName → [reports]` map, BFS-rooted at the requester's own
  display name, then unioned with active C19 delegations.
- `candidateService.collectHierarchyEmails(user)` (`backend/src/services/candidateService.js:290`)
  — same map + `walkSubtree` BFS, returning `{ allSubordinateEmails, recruiterEmails }`, then unioned
  with delegations.

Because matching is by display name, the walk can cross into another team — via same-display-name
leads on different teams, or mis-set `teamLead` strings that bridge teams. CLAUDE.md §3 calls this out:
"Phase 2 will tighten BFS hierarchy walks to be team-scoped — until then, cross-team peeking is still possible."

## Goal

Make both own-subtree walks respect `team` (strict same-team), **without** touching C19 delegations
(which are intentionally cross-team) and **without** locking anyone out when `team` data is missing.

## Decisions (locked via brainstorm)

1. **Strict same-team partition.** Below admin, a requester only reaches users/candidates whose `team`
   equals the requester's own team. Admins (team-less) are unaffected. Legitimate cross-team access
   happens **only** through an explicit C19 delegation.
2. **Fail-open + warn on missing team.** If either side has no `team`, fall back to today's name-chain
   result for that pair and emit a deduped straggler warning. Scoping can only ever *remove*
   clearly-cross-team access (both sides teamed, teams differ); it can never lock anyone out. This
   ships safely **ahead of** the C20 role migration being fully verified in prod.
3. **Backend only.** Frontend role rename is considered handled by the redesign's label map.
   Verifying/running the migration and a future flip to fail-closed are **separate** follow-ups.

## Constraints

- Do not change C19 delegation behavior. The team gate applies to the **own-subtree** walk only;
  delegation unions (`subtree` / `specific`) stay cross-team.
- Backend stays authoritative; no contract changes; legacy + new role names both still accepted
  (dual-read window).
- Surgical change to two hot, security-sensitive functions — minimize blast radius.

## Architecture (Approach A — surgical inline gate)

One shared **pure predicate** is the single source of truth for the rule; both walks call it inline.

```js
// backend/src/services/userService.js — exported, pure
// Returns { allowed, straggler }.
export const teamScopeDecision = (requesterTeam, targetTeam) => {
  const a = (requesterTeam || '').toLowerCase().trim() || null;
  const b = (targetTeam   || '').toLowerCase().trim() || null;
  if (!a) return { allowed: true, straggler: false }; // requester un-teamed (incl. admins) → fail-open
  if (!b) return { allowed: true, straggler: true  }; // target un-teamed → fail-open + warn
  return { allowed: a === b, straggler: false };       // both teamed → strict same-team
};
```

A small companion `emitTeamStragglerWarning(email, source)` mirrors the existing
`emitLegacyRoleWarning` (structured, deduped `logger.warn`).

## Components / files (2 + tests)

1. **`backend/src/services/userService.js`**
   - Export `teamScopeDecision` + add `emitTeamStragglerWarning`.
   - `isUserInRequesterHierarchy`: resolve the requester's authoritative `team` from the existing
     `getAllUsers()` snapshot (find self by normalized email — **not** the token, to avoid
     staleness/missing-team). Give the inner `bfsContains` an `enforceTeam` flag. Call with
     `enforceTeam = true` for the own root (line ~580); `false` for delegation subtree roots (line ~595).
2. **`backend/src/services/candidateService.js`**
   - Import `teamScopeDecision` from `userService.js` (already imports from there, line 52).
   - `collectHierarchyEmails`: resolve requester `team` from its `getAllUsers()` snapshot; give
     `walkSubtree` an `enforceTeam` flag — `true` for the own root (line ~334), `false` for delegation
     subtree roots (line ~362).
3. **Tests** — `backend/src/services/__tests__/` for both functions (matrix below).

## Data flow (per walk)

1. Resolve `requesterTeam` from the live snapshot.
2. In the report loop, when `enforceTeam` is true: compute `teamScopeDecision(requesterTeam, report.team)`.
   - `allowed === false` → **skip both inclusion and traversal** (don't add the email, don't enqueue
     the report's reports). This prunes cross-team bridges that a post-filter would miss.
   - `straggler === true` → `emitTeamStragglerWarning(report.email, '<walk>')`, then include + traverse.
3. Delegation unions run with `enforceTeam = false` → unchanged, still cross-team.

## Edge cases / blast radius

- **Admins** (`team = null`) → fail-open → byte-for-byte today's behavior. No regression. Existing
  `canManageUsers`/`role === 'admin'` short-circuits above the BFS are untouched.
- **Managers** (mm = marketing, etc.) → correctly scoped to their own team.
  **Assumption:** no single human legitimately manages two teams outside a delegation. If a real
  cross-team GM exists, they use a C19 delegation or are admin. (Flag during review if false.)
- **Sales team** → same-team like any other; fine if sparse/empty.
- **Affected surfaces** (the intended tightening — everything flowing through these two walks):
  profile reads (C8/C19), candidate list/queries (`collectHierarchyEmails`, e.g. `candidateService.js:1247`),
  resume queue. **Implementation must audit all callers** (including the `GET /api/users/manageable`
  path the redesign uses) to confirm scoping lands only where intended and nothing regresses.
- **Self** always visible (early `target === requester` return, untouched).
- **Name collisions across teams** — the original hole — are closed: a same-named lead on another
  team is now pruned because its `team` differs.

## Error handling

- Delegation lookup failures already fall back to the own-subtree result (kept).
- Straggler warnings are logged (deduped), never thrown. The walk continues.

## Testing (Jest, both services)

| Case | Expected |
|---|---|
| Same-team report | included / reachable |
| Cross-team report (both teamed) | excluded **and not traversed-through** (bridge test) |
| Requester `team = null` | old behavior (cross-team still reachable) |
| Target `team = null` | included + straggler warn emitted |
| Cross-team C19 `specific` delegation | still reachable / still in the email set |
| Cross-team C19 `subtree` delegation | still reachable / still in the email set |
| Admin requester (`team = null`) | unchanged from today |

## Rollout

- Ships as a normal PR + auto-deploy. Fail-open ⇒ no access removed for un-teamed data, so it is safe
  ahead of the migration.
- The straggler warn logs measure how many un-teamed users/candidates remain — the signal for a
  **future** phase that verifies the migration in prod and flips the predicate to fail-closed.

## Out of scope

- Frontend deep role rename.
- Running / verifying the C20 role migration in prod.
- The fail-closed flip (future phase, gated on migration verification).

## Companion: backlog doc reconciliation (bundled in this branch)

CLAUDE.md §6/§7 were stale (listed C16 and C19 as open though both shipped). This branch also updates
CLAUDE.md to reflect git reality: **C16** (`4d45db8`), **C19** (6 phases + Delegations UI, #112–#119),
**C20 phase 1** (#101/`2435f54`), and **SP3** (#172–#175) are shipped; the genuinely-open backlog is
**C20 phase 2** (this spec), **PRT retention/archival**, and **P5c/P5d/P5e** polish.
