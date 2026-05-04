# Role-by-role functionality audit

Generated 2026-05-04 after C20 phase 1 + frontend/backend role alias shims (PRs #101, #104, #105, #106, #107).

## Scope

Every role-gated page, sidebar link, action button, and API guard. Roles in the post-migration model:

| Legacy | New | Team |
|---|---|---|
| `admin` | `admin` | — |
| `mm` | `manager` | marketing (or technical for cross-team mm via C19 forever-share) |
| `mam` | `assistantManager` | marketing |
| `am` | `assistantManager` | technical |
| `mlead` | `teamLead` | marketing |
| `lead` | `teamLead` | technical |
| `recruiter` | `recruiter` | marketing |
| `user` | `expert` | technical |

The shims make `req.user.role` and `localStorage.role` always be the **legacy** form on the consumer side. Gates that check legacy strings work correctly for migrated users.

## Sidebar (`frontend/src/components/layout/Sidebar.tsx`)

| Link | admin | mm | mam | am | mlead | lead | recruiter | expert |
|---|---|---|---|---|---|---|---|---|
| Tasks Today | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Branch Candidates | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Jobs | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ |
| Admin Alerts | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Reports / management section | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| User Management | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Permissions Management | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### Gaps found

- **Line 122 / 126 `showCandidates` / `hideCandidates`**: legacy-only lists. After PR #107 these now include new names, but verify the `expert`/`user` distinction matches the design intent — `expert` (was `user`) should see Tasks but not Branch Candidates. The current gate says yes to both. **Confirm or tighten.**
- **Line 466 `mtl` reference**: stray legacy abbreviation that nobody has anymore. **Remove the `'mtl'` entry.**
- **Line 482 (~"Resume Discussion" link?)**: `['admin', 'mam', 'mm', 'mlead', 'recruiter']` — legacy-only. Will not match `manager` / `assistantManager` / `teamLead`. **Patch.**

## Pages

### `BranchCandidates.tsx` (page wrapper) and `BranchCandidates.tsx` (card)

- **canView gate**: `['admin','mm','mam','mlead','lead','user','am','manager','recruiter']` — accepts most roles but missing `'assistantmanager'` / `'teamlead'` / `'expert'`. **Fix.**
- **`isManager` check** (line 328 of card): `['mm', 'mam', 'admin', 'manager', 'assistantmanager']`. ✓ (after PR #103).
- **Search input**: enabled for everyone (after PR #103). ✓
- **Actions per row** (Mock / Interview / Assessment / Resume): role-gated by `canEdit`. Inspect — confirm legacy + new accepted.

### `TasksToday.tsx`

| Feature | Gate | Notes |
|---|---|---|
| `isMarketing` (line ~461) | `['admin', 'mm', 'mam', 'mlead', 'recruiter']` | OK for legacy. **Add `manager`, `assistantmanager`, `teamlead`** for defense. |
| `isManagerView` | `!['user', 'lead']` | Negation works for both name forms accidentally. |
| Multiple `['recruiter', 'mlead', 'mam', 'mm']` checks | legacy-only | **Add new names.** |
| `entry.role === 'mlead'` / `=== 'mam'` (line 3858, 3886) | reads incoming user roles | **PR #104 normalizes incoming role to legacy via the shim, so OK.** |
| Filter dropdowns showing `mlead`/`mam`/`lead`/`am`/`recruiter` filter pills (lines 4198-4233) | legacy-only | **Confirm: localStorage has legacy form; OK in practice.** |

### `UserManagement.tsx`

- **canManage gate**: `['admin', 'manager', 'mm', 'mam', 'mlead', 'lead', 'am']`. ✓
- **rosterSets switch + getTeamLeadOptions**: extended for new names in PR #103. ✓
- **Many internal `normalizedRole === 'mlead'` style checks**: localStorage has legacy form (PR #104 + #105), so these match.
- **`showTeamLeadInput / showManagerInput`**: `['admin', 'manager']`. ✓ accepts both.

### `Reports.tsx`

- Line 156: `['admin', 'MM', 'MAM', 'mlead']` — **case-sensitive**, will fail for lowercase legacy roles. Pre-existing bug, not caused by C20. **Lowercase the comparator strings.**

### `Index.tsx`

- Line 10: `['admin', 'MM', 'MAM', 'mlead']` — same case-sensitivity bug. **Fix.**

### `AdminAlerts.tsx`

- Single check `normalizedRole === 'admin'`. ✓

### `PermissionsManagement.tsx`

- `user?.role?.toLowerCase() === 'admin'`. ✓

### `AuthorizedRoute.tsx`

- `PROFILE_HUB_ROLES`, `JOBS_ROLES` extended in PR #107. ✓
- `isMarketing()` line 12: `=== 'MAM' || === 'MM'` (uppercase). **Pre-existing bug — never matched lowercase storage. Fix.**

### `BranchCandidates` card — internal action gates

(Card is `frontend/src/components/dashboard/BranchCandidates.tsx`, ~3500 LOC)

- Status update (line 411): `['recruiter', 'mlead', 'mam', 'mm', 'admin']`. **Patched in PR #107? No — that PR was backend. Add new names here too.**
- Bulk status update (line 482): same gate, same patch needed.
- Multiple `canEdit` / `canCreate` / `canDelete` flags driven off these.

### Backend socket handlers (`backend/src/sockets/candidateSocket.js`)

Status updates / bulk updates / claim / unclaim — multiple legacy-only `.includes(role)` arrays. After PR #106's auth-middleware shim, `socket.data.user.role` is now legacy form, so they match. **Verify this PR is deployed before assuming OK.**

### Backend routes (`backend/src/routes/users.js`)

All `requireHTTPRole(['admin', 'mm', 'mam', 'mlead', 'lead', 'am'])` arrays — covered by PR #106's level-based middleware which accepts both forms. ✓

## Recommended fix order

1. **Already fixed in PRs #103, #104, #105, #106, #107**: dual-accept maps, alias shims (frontend + backend), localStorage hard-reset, _scopeFilter default-deny, sidebar gate extensions for the highest-impact links.
2. **Next short PR (5-15 line edits)**:
   - Sidebar line 122/126/466/482 — extend new names, drop stray `'mtl'`.
   - BranchCandidates card status-update gates — extend new names (defense in depth even though the shim makes role legacy).
   - TasksToday role-array sites — extend new names (defense).
   - Reports/Index/AuthorizedRoute uppercase-MM/MAM bugs — pre-existing, unrelated to C20 but worth fixing.
3. **Followup audit**: BranchCandidates card has many internal `isManager` / `canEdit` derivations. They're driven by a normalized `role` from localStorage which IS legacy. Sample-check the major actions per role — currently no obvious bug.

## What the user should test after these PRs

| Role | Login as | Expect |
|---|---|---|
| admin | harsh.patel@... | Sees everything; can edit any user; sees Admin Alerts, Permissions. |
| manager (mm) | tushar.ahuja@... | Sees branch candidates (filtered to GGR per the hardcoded branch-mapping), Reports, Jobs, User Management, no Admin Alerts. |
| assistantManager-marketing (mam) | shashank.sharma@... | Sees his hierarchy's candidates only, can manage his teamLeads + recruiters in User Management, can do bulk status updates. |
| teamLead-marketing (mlead) | satyam.gupta@... | Sees only his 14 recruiters' candidates, can manage them in User Management, can do status updates. **The reported regression should be resolved.** |
| assistantManager-technical (am) | someone with team='technical' | Sees their lead's experts, Tasks Today filters apply, no Branch Candidates write. |
| teamLead-technical (lead) | someone with team='technical' | Sees only their experts. |
| expert (user) | a technical IC | Sees only their own tasks/candidates. |
| recruiter | any recruiter | Sees only their assigned candidates; can update status; can request resume. |

## Open follow-ups

- **C19** — peer-to-peer Share/Transfer (the audit's top remaining backlog item).
- **C16** — pre-save validator at the model layer.
- **Eventually drop the legacy alias shim** once every site uses canonical names. Likely after the Sales team onboards, since that's when the legacy names actually become misleading.
