# User Management Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** Replace the 1,452-line `pages/UserManagement.tsx` with a searchable **directory + per-user edit drawer** under `features/userManagement/`, driven by one `rolePolicy` config, in the existing app theme.

**Architecture:** Frontend-only. Same data contracts (`GET /api/users/manageable`, `POST`/`PUT /api/users/bulk`). One `rolePolicy` config encodes every actor→target rule (replacing ~50 inline conditionals); a `roleLabels` map gives friendly display names (wire tokens unchanged). Components compose into `UserManagementPage`; `pages/UserManagement.tsx` becomes a thin re-export.

**Tech Stack:** React 18 + TS, Vitest + Testing Library, shadcn/ui (`@/components/ui/*`), Tailwind semantic tokens (dark "aurora" theme). **No new palette/fonts/bespoke CSS** — reuse primitives + tokens (`bg-card`, `text-muted-foreground`, `border`, `Badge` variants, `Sheet side="right"`), consistent with `BranchCandidates`/`TasksToday`.

**Spec:** `docs/superpowers/specs/2026-06-04-user-management-redesign-design.md`. **Mockups** (reference for layout/theme): `.superpowers/brainstorm/43905-1780603555/content/{directory-detail,edit-drawer,add-users-hierarchy}.html`.

---

## Legacy role tokens (used everywhere on the wire)
`admin, mm, mam, am, mlead, lead, recruiter, user`. The page reads users via `GET /api/users/manageable` and normalizes new→legacy with `toLegacyRole(role, team)` from `@/lib/roleAliases`. Actor context from `localStorage`: `role`, `email`, `manager`, `displayName`.

## The rule matrix (single source of truth — encode verbatim in Task 2)
Per **actor** (legacy token):
- **admin** — canCreate/Assign: all 8. Fields: all `editable`. No auto-fill.
- **mm** — canCreate `[mam,mlead,recruiter]`; canAssign `[mam,mlead,recruiter]` (role on update is **locked**, only those targets selectable in create). Update: `manager` **forced = self||actorManager**; `teamLead` hidden for target `mam`, preserved-if-blank for `mlead`/`recruiter`; `active`,`password` editable.
- **mam** — canCreate/Assign `[mlead,recruiter]`. Create→`mlead`: `teamLead=self`, `manager=targetDerivedName` (if blank). Update→`mlead`: `teamLead=self`,`manager=actorManager` (if blank); →`recruiter`: preserve existing teamLead/manager else fallback. `role`,`active`,`password` editable.
- **am** — canCreate/Assign `[lead,user]`. Create→`lead`: `teamLead=self`,`manager=actorManager` (if blank). Update→`lead`: same; →`user`: `manager=actorManager` (if blank), `teamLead` editable. `role`,`active`,`password` editable.
- **mlead** — canCreate `[recruiter]`; canAssign **none** (role **locked**, create force-sets role→`recruiter`). Create/Update: `teamLead=self`,`manager=actorManager` (if blank) — shown **locked/display**. `active`,`password` editable.
- **lead** — canCreate/Assign `[user]`. Create/Update: `teamLead=self`,`manager=actorManager` (if blank) — shown **locked/display**. `role`,`active`,`password` editable.
- **recruiter, user** — canCreate/Assign none; cannot manage (page hidden).

teamLead **option rosters** (for `editable` teamLead selects), from the loaded users grouped by role: `user`→ leads+ams+managers; `lead`→ ams+managers; `am`→ managers; `recruiter`→ mleads+mams+managers; `mlead`→ mams+managers; `mam`→ managers. Manager options: managers (mm roster for `recruiter` target). "self" = `formatNameInput(deriveDisplayNameFromEmail(localStorage.email))`; "actorManager" = `formatNameInput(localStorage.manager)`.

## API payloads (unchanged)
- Create: `POST /api/users/bulk` body `{ users: [{ email, password, role, teamLead?, manager?, active }] }` → `{ success, created:[{email,role}], failures:[{index,email,error}] }`.
- Update: `PUT /api/users/bulk` body `{ users: [{ email, role?, teamLead?, manager?, active?, password? }] }` → `{ success, updates:[{email,appliedChanges[]}], failures:[...] }`.
- Read: `GET /api/users/manageable` → `{ success, users: [{ email, role, team?, teamLead?, manager?, active, acceptsTasks? }] }`. Inline toggle = a `PUT /api/users/bulk` with `{ users:[{ email, active }] }` or `{ users:[{ email, acceptsTasks }] }` (acceptsTasks is supported by the existing bulk update — confirm field name against `userController.bulkUpdateUsers`; if it's `accepts_tasks` or similar, match it).

---

### Task 1: `roleLabels.ts`

**Files:** Create `frontend/src/features/userManagement/roleLabels.ts`; Test `frontend/src/features/userManagement/__tests__/roleLabels.test.ts`.

- [ ] **Step 1 — failing test:**
```ts
import { describe, it, expect } from 'vitest';
import { roleLabel, roleBadgeVariant, LEGACY_ROLES } from '../roleLabels';
describe('roleLabels', () => {
  it('labels every legacy token', () => {
    expect(LEGACY_ROLES.every(r => typeof roleLabel(r) === 'string' && roleLabel(r).length > 0)).toBe(true);
    expect(roleLabel('mm')).toBe('Marketing Manager');
    expect(roleLabel('user')).toBe('Expert');
    expect(roleLabel('mlead')).toBe('Team Lead (Marketing)');
  });
  it('falls back to the raw token for unknowns', () => { expect(roleLabel('weird')).toBe('weird'); });
  it('maps every token to a badge variant', () => {
    expect(LEGACY_ROLES.every(r => !!roleBadgeVariant(r))).toBe(true);
  });
});
```
- [ ] **Step 2 — run, expect FAIL:** `cd frontend && npx vitest run src/features/userManagement/__tests__/roleLabels.test.ts`
- [ ] **Step 3 — implement:**
```ts
// frontend/src/features/userManagement/roleLabels.ts
export type LegacyRole = 'admin'|'mm'|'mam'|'am'|'mlead'|'lead'|'recruiter'|'user';
export const LEGACY_ROLES: LegacyRole[] = ['admin','mm','mam','am','mlead','lead','recruiter','user'];

const LABELS: Record<LegacyRole, string> = {
  admin: 'Admin',
  mm: 'Marketing Manager',
  mam: 'Asst. Manager (Marketing)',
  am: 'Asst. Manager (Technical)',
  mlead: 'Team Lead (Marketing)',
  lead: 'Team Lead (Technical)',
  recruiter: 'Recruiter',
  user: 'Expert',
};
export function roleLabel(role: string): string {
  return LABELS[(role || '').toLowerCase() as LegacyRole] ?? role;
}
// Use ONLY existing Badge variants (default | secondary | destructive | outline) — no new palette.
type BadgeVariant = 'default'|'secondary'|'outline';
const VARIANTS: Record<LegacyRole, BadgeVariant> = {
  admin: 'default', mm: 'default', manager: 'default',
  mam: 'outline', am: 'outline',
  mlead: 'secondary', lead: 'secondary',
  recruiter: 'secondary', user: 'secondary',
} as unknown as Record<LegacyRole, BadgeVariant>;
export function roleBadgeVariant(role: string): BadgeVariant {
  return VARIANTS[(role || '').toLowerCase() as LegacyRole] ?? 'secondary';
}
```
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit:** `git add frontend/src/features/userManagement/roleLabels.ts frontend/src/features/userManagement/__tests__/roleLabels.test.ts && git commit -m "feat(user-mgmt): role label + badge-variant map"`

---

### Task 2: `rolePolicy.ts` (the config that replaces ~50 conditionals)

**Files:** Create `frontend/src/features/userManagement/rolePolicy.ts`; Test `.../__tests__/rolePolicy.test.ts`.

**Interface (use exactly these names everywhere downstream):**
```ts
export type FieldKey = 'role'|'team'|'teamLead'|'manager'|'active'|'acceptsTasks'|'password';
export type FieldState = 'editable'|'auto'|'locked'|'hidden';
export interface ActorContext { selfDisplayName: string; actorManager: string; } // from localStorage
export interface PolicyResult { state: FieldState; value?: string|boolean; reason?: string; }
// canCreate(actor): which target roles this actor may create
export function canCreate(actor: string): LegacyRole[];
// canAssign(actor): which target roles selectable on update ([] => role field locked)
export function canAssign(actor: string): LegacyRole[];
// fieldPolicy: for a given actor editing/creating a target of `targetRole`, the state + auto value of one field
export function fieldPolicy(actor: string, targetRole: string, field: FieldKey, ctx: ActorContext): PolicyResult;
```

- [ ] **Step 1 — failing test** (encode the matrix; representative assertions — add one per rule from "The rule matrix"):
```ts
import { describe, it, expect } from 'vitest';
import { canCreate, canAssign, fieldPolicy } from '../rolePolicy';
const ctx = { selfDisplayName: 'Me Lead', actorManager: 'My Mgr' };
describe('rolePolicy', () => {
  it('admin can create/assign all', () => {
    expect(canCreate('admin')).toEqual(['admin','mm','mam','am','mlead','lead','recruiter','user']);
    expect(canAssign('admin')).toEqual(['admin','mm','mam','am','mlead','lead','recruiter','user']);
    expect(fieldPolicy('admin','user','manager',ctx).state).toBe('editable');
  });
  it('mm: role locked on update, manager forced to self', () => {
    expect(canAssign('mm')).toEqual(['mam','mlead','recruiter']);
    expect(fieldPolicy('mm','mlead','role',ctx).state).toBe('locked');
    const m = fieldPolicy('mm','mlead','manager',ctx); expect(m.state).toBe('auto'); expect(m.value).toBe('Me Lead');
    expect(fieldPolicy('mm','mam','teamLead',ctx).state).toBe('hidden');
  });
  it('mam→mlead: teamLead auto=self', () => {
    const t = fieldPolicy('mam','mlead','teamLead',ctx); expect(t.state).toBe('auto'); expect(t.value).toBe('Me Lead');
  });
  it('mlead: cannot change role, teamLead/manager locked to self/actorManager', () => {
    expect(canAssign('mlead')).toEqual([]);
    expect(fieldPolicy('mlead','recruiter','role',ctx).state).toBe('locked');
    expect(fieldPolicy('mlead','recruiter','teamLead',ctx)).toMatchObject({ state:'locked', value:'Me Lead' });
    expect(fieldPolicy('mlead','recruiter','manager',ctx)).toMatchObject({ state:'locked', value:'My Mgr' });
  });
  it('am→lead: teamLead auto=self, manager auto=actorManager; →user: teamLead editable', () => {
    expect(fieldPolicy('am','lead','teamLead',ctx)).toMatchObject({ state:'auto', value:'Me Lead' });
    expect(fieldPolicy('am','user','teamLead',ctx).state).toBe('editable');
  });
  it('recruiter/user manage nothing', () => {
    expect(canCreate('recruiter')).toEqual([]); expect(canAssign('user')).toEqual([]);
  });
});
```
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** `rolePolicy.ts` encoding the full matrix above. Structure: a `CAN_CREATE`/`CAN_ASSIGN` record, and a `fieldPolicy` that switches on `(actor, targetRole, field)` returning `{state, value, reason}`. `active` and `password` are always `editable` for managing actors. `team` is `editable` for admin else `hidden` (the wire keeps team; non-admins don't set it here). Normalize inputs with `.toLowerCase()`. Pull "self"/"actorManager" from `ctx`. **Mirror the extracted rules exactly** (auto-fill only "if blank" semantics are enforced at submit-time by the drawer/create form, but the policy reports the auto `value` so the UI can show it).
- [ ] **Step 4 — run, expect PASS** (extend tests until every matrix rule is covered).
- [ ] **Step 5 — commit:** `feat(user-mgmt): rolePolicy config (canCreate/canAssign/fieldPolicy)`

---

### Task 3: `useManageableUsers.ts` (data + client-side filter/sort/group)

**Files:** Create `frontend/src/features/userManagement/useManageableUsers.ts` + `.../grouping.ts` (pure helpers) + tests `.../__tests__/grouping.test.ts`.

- [ ] **Step 1 — failing test for the pure helpers** (`grouping.ts`): `filterUsers(users, {search, role, team, active, acceptsTasks})`, `sortUsers(users, key, dir)`, `groupUsers(users, by)` where `by ∈ 'teamLead'|'team'|'manager'|'none'` → `{ groupKey, label, users[] }[]`.
```ts
import { describe, it, expect } from 'vitest';
import { filterUsers, groupUsers } from '../grouping';
const U = [
  { email:'a@x', role:'recruiter', teamLead:'Prateek', team:'marketing', active:true, acceptsTasks:false },
  { email:'b@x', role:'user', teamLead:'Prateek', team:'technical', active:false, acceptsTasks:true },
];
describe('grouping', () => {
  it('filters by search across name+email and by role', () => {
    expect(filterUsers(U as any, { search:'b@', role:'all', team:'all', active:'all', acceptsTasks:'all' })).toHaveLength(1);
    expect(filterUsers(U as any, { search:'', role:'user', team:'all', active:'all', acceptsTasks:'all' })).toHaveLength(1);
  });
  it('groups by teamLead', () => {
    const g = groupUsers(U as any, 'teamLead');
    expect(g).toHaveLength(1); expect(g[0].label).toBe('Prateek'); expect(g[0].users).toHaveLength(2);
  });
});
```
- [ ] **Step 2 — run FAIL → Step 3 — implement** `grouping.ts` (pure) + `useManageableUsers.ts` (the hook: `authFetch('/api/users/manageable')`, map `toLegacyRole(u.role,u.team)`, expose `{ users, loading, error, refetch, actorContext }`; read `localStorage` role/email/manager/displayName once; build `actorContext.selfDisplayName`/`actorManager`). → **Step 4 — PASS.**
- [ ] **Step 5 — commit:** `feat(user-mgmt): data hook + filter/sort/group helpers`

---

### Task 4: `RoleBadge` + `UserRow` + `UserTable`

**Files:** Create `RoleBadge.tsx`, `UserRow.tsx`, `UserTable.tsx` under the feature dir; Test `.../__tests__/UserTable.test.tsx`.

**Contracts:**
- `RoleBadge({ role })` → `<Badge variant={roleBadgeVariant(role)}>{roleLabel(role)}</Badge>`.
- `UserRow({ user, selected, canToggleActive, canToggleAccepts, onSelect, onOpen, onToggleActive, onToggleAccepts })` — a `<TableRow>` with: checkbox, Name+email (stacked, `text-muted-foreground` for email), `<RoleBadge>`, Team, Manager, **Active** `<Switch>` (disabled w/ tooltip if `!canToggleActive`), **Accepts** `<Switch>` (or `—` when n/a for the role), `⋯`/row-click → `onOpen(user)`.
- `UserTable({ groups, ... })` — themed `<Table>` (`@/components/ui/table`); render each group with a sticky-ish group header row (`bg-muted/40 text-xs`) showing `label (count)`, then its rows. Header row of column titles. Use existing table styles only.

- [ ] **Step 1 — failing test:** renders a group header + rows; clicking a row calls `onOpen`; toggling Active calls `onToggleActive(user, next)`; disabled toggle shows when `canToggleActive=false`. Mock the callbacks.
- [ ] **Step 2 FAIL → Step 3 implement (theme: only `@/components/ui/*` + tokens; mirror `directory-detail.html` columns) → Step 4 PASS.**
- [ ] **Step 5 — commit:** `feat(user-mgmt): grouped users table + row + role badge`

---

### Task 5: `DirectoryToolbar`

**Files:** Create `DirectoryToolbar.tsx`; Test `.../__tests__/DirectoryToolbar.test.tsx`.

**Contract:** `DirectoryToolbar({ search, onSearch, filters, onFilter, groupBy, onGroupBy, sort, onSort, canCreate, onAddUsers })`. Uses `Input` (search), `Select`s for Role/Team/Active/Accepts filters + Group-by + Sort, and a primary `Button` "Add users" (shown only when `canCreate`). Layout/labels per `directory-detail.html` toolbar. Filter option lists derive from `LEGACY_ROLES` (via `roleLabel`) + teams `['marketing','technical','sales']` + `['all','active','inactive']`.

- [ ] **Step 1 — failing test:** typing in search calls `onSearch`; choosing a role filter calls `onFilter({role})`; "Add users" hidden when `canCreate=false`. → **Step 2 FAIL → Step 3 implement → Step 4 PASS.**
- [ ] **Step 5 — commit:** `feat(user-mgmt): directory toolbar (search/filter/group/sort/add)`

---

### Task 6: `BulkActionBar`

**Files:** Create `BulkActionBar.tsx`; Test `.../__tests__/BulkActionBar.test.tsx`.

**Contract:** `BulkActionBar({ count, selectedRoles, actorContext, onApply })`. Appears when `count>0` (themed `bg-emerald-500/10`-equivalent via tokens — reuse the same accent as elsewhere, no new color). Offers actions valid for ALL selected roles per `rolePolicy`: "Set active/inactive", "Change team lead", "Change manager" (and "Change role" only if every selected role is in `canAssign(actor)`). `onApply(patch)` → caller PUTs `{ users: selected.map(e => ({ email:e, ...patch })) }`.

- [ ] **Step 1 — failing test:** with 2 selected, "Set inactive" calls `onApply({active:false})`; "Change role" hidden when a selected role isn't assignable. → **FAIL → implement → PASS.**
- [ ] **Step 5 — commit:** `feat(user-mgmt): bulk-action bar`

---

### Task 7: `EditUserDrawer` (policy-driven)

**Files:** Create `EditUserDrawer.tsx`; Test `.../__tests__/EditUserDrawer.test.tsx`.

**Contract:** `EditUserDrawer({ open, user, actorRole, actorContext, teamLeadOptions, managerOptions, onClose, onSaved })`. Uses `Sheet`+`SheetContent side="right"` (`@/components/ui/sheet`). For each `FieldKey` in `['role','team','teamLead','manager','active','acceptsTasks']`, call `fieldPolicy(actorRole, user.role, field, actorContext)` and render by state:
- `editable` → control (role = `Select` limited to `canAssign(actorRole)`; teamLead/manager = `Select` from options or input; active/acceptsTasks = `Switch`).
- `auto` → read-only display of `result.value` + hint text (`text-xs text-muted-foreground`) e.g. "auto-set from the team lead".
- `locked` → read-only + a lock glyph + `result.reason`.
- `hidden` → render nothing.
Save → build the update entry (only changed/allowed fields; apply the `auto` values), `PUT /api/users/bulk` `{ users:[entry] }`, then `onSaved(result)`. "Reset password" sets `password` in the entry. Header shows `user.email` (read-only). Match `edit-drawer.html`.

- [ ] **Step 1 — failing test:** for actor `mlead` editing a `recruiter`: role field is read-only (locked), teamLead shows "Me Lead" locked, Save PUTs `{ users:[{ email, active?, ... }] }` without a `role` key. For actor `admin`: role Select present with all options. Mock `authFetch`.
- [ ] **Step 2 FAIL → Step 3 implement → Step 4 PASS.**
- [ ] **Step 5 — commit:** `feat(user-mgmt): policy-driven edit drawer`

---

### Task 8: `AddUsersDrawer`

**Files:** Create `AddUsersDrawer.tsx`; Test `.../__tests__/AddUsersDrawer.test.tsx`.

**Contract:** `AddUsersDrawer({ open, actorRole, actorContext, teamLeadOptions, managerOptions, onClose, onCreated })`. `Sheet side="right"` with `Tabs`: **Form** (one user; "+ Add another" pushes a blank row; each row's fields use `fieldPolicy` + `canCreate(actorRole)` for the role Select; mlead force-sets role→recruiter) and **Bulk paste** (a `Textarea` of emails; on "Parse" → one row each with policy defaults; review; create). Submit both → `POST /api/users/bulk` `{ users:[...] }`, surface `created`/`failures`, then `onCreated()`. Match `add-users-hierarchy.html`.

- [ ] **Step 1 — failing test:** single-row form for actor `mam` creating `mlead` auto-fills teamLead="Me Lead"; "Create" POSTs `{ users:[{ email, password, role:'mlead', teamLead:'Me Lead', ... }] }`. Bulk-paste of 2 emails yields 2 rows. → **FAIL → implement → PASS.**
- [ ] **Step 5 — commit:** `feat(user-mgmt): add-users drawer (form + bulk paste)`

---

### Task 9: `UserManagementPage` + swap the route file

**Files:** Create `UserManagementPage.tsx`; Modify `frontend/src/pages/UserManagement.tsx` (replace body with a re-export).

- [ ] **Step 1 — implement `UserManagementPage.tsx`:** wraps `DashboardLayout`; uses `useManageableUsers`; holds UI state (search/filters/groupBy/sort/selection/drawer-open/add-open); composes `DirectoryToolbar` + `UserTable` + `BulkActionBar` + `EditUserDrawer` + `AddUsersDrawer`. Gates: render manage UI only when actor role ∈ `['admin','mm','mam','mlead','lead','am']`; "Add users" only when `canCreate(actorRole).length>0`. Inline toggles + drawer saves + bulk applies all `refetch()` on success (or optimistic patch). Loading → `Skeleton` rows; error → banner + retry; empty → themed empty state.
- [ ] **Step 2 — replace `pages/UserManagement.tsx`:**
```tsx
export { UserManagementPage as default } from '@/features/userManagement/UserManagementPage';
```
(Adjust to match how the router imports it — keep the same export shape the route expects; if the route imports a named `UserManagement`, re-export under that name.)
- [ ] **Step 3 — build:** `cd frontend && npm run build` → succeeds (tsc clean).
- [ ] **Step 4 — commit:** `feat(user-mgmt): compose redesigned page + route swap`

---

### Task 10: Verify + PR

- [ ] **Step 1 — run feature tests:** `cd frontend && npx vitest run src/features/userManagement` → all PASS.
- [ ] **Step 2 — full build:** `npm run build` → clean.
- [ ] **Step 3 — manual (real session):** as admin — search/filter/group; open a row → change role/teamLead/active → Save → row updates; inline-toggle Active; select 2 → bulk set-inactive; Add users (single + bulk-paste) → created. As `mlead` — role field locked, teamLead shows self. Verify nothing 403s that worked before.
- [ ] **Step 4 — PR** `feat(user-mgmt): redesigned directory + edit drawer (same theme)`. Body: link spec + plan; note frontend-only, contracts unchanged, role tokens unchanged (display labels only), backend still authoritative. Plain message, no AI-attribution trailer.

---

## Self-review
- **Spec coverage:** directory (T4/5), edit drawer (T7), add-users (T8), bulk bar (T6), rolePolicy (T2), labels (T1), group-by-only hierarchy (T3 grouping; no tree), theme (every UI task: `@/components/ui/*` + tokens only), data contracts unchanged (T3/7/8 payloads), permissions preserved (T2 + T9 gates). ✓
- **Type consistency:** `LegacyRole`, `FieldKey`, `FieldState`, `PolicyResult`, `ActorContext`, `canCreate`/`canAssign`/`fieldPolicy`, `roleLabel`/`roleBadgeVariant` used consistently across tasks. ✓
- **Placeholders:** config/labels/hook + their tests are full code; component tasks give exact props + behavior + the themed primitives + mockup file refs (the JSX is mechanical given the mockups + spec). The one verify-needed unknown is the exact `acceptsTasks` field name on the bulk-update endpoint — flagged in T-payloads to confirm against `userController.bulkUpdateUsers`.
- **Risk:** behavior parity with the old page hinges on `rolePolicy` matching the extracted matrix — T2's tests enforce that rule-by-rule; the server remains authoritative regardless.
