# User Management UI/UX Redesign — Design

> Date: 2026-06-04. Branch: `feat/user-management-redesign`. Scope: **frontend only**.

## Problem

`frontend/src/pages/UserManagement.tsx` is a single ~1,452-line file with three stacked cards
(bulk-create grid, bulk-update panel, read-only table). It's hard to use and hard to maintain:

- **No per-user editing** — to change one person you tick a checkbox and use a bulk panel above the table.
- **No search / filter / sort / pagination** — the table assumes a short list.
- **Cryptic roles** — raw tokens (`mm`, `mam`, `mlead`, `am`, `lead`, `user`) with no friendly labels, team, or hierarchy at a glance.
- **~50 scattered `if (role === …)` conditionals** + nested IIFE/ternary JSX deciding field visibility/locking/auto-fill, **duplicated** across the create and update forms.

## Goal

Redesign the page around a **searchable directory + per-user edit drawer**, with the role rules
consolidated into one config. Outcome: scan, edit-one-fast, and onboard all work from a clean surface,
and the role logic lives in one place.

## Hard constraints (do not violate)

1. **Frontend only.** No backend changes. Keep the existing data contracts:
   - Read: `GET /api/users/manageable` → `{ email, role, teamLead?, manager?, active, acceptsTasks?, team? }[]`.
   - Create: `POST /api/users/bulk`. Update: `PUT /api/users/bulk`. Same payload shapes as today.
   - The `toLegacyRole(role, team)` alias shim (from `@/lib/roleAliases`) still normalizes on load (C20 dual-read).
2. **No backend role rename.** Roles stay as the legacy tokens on the wire. Friendly names are a **display-only label map** (CLAUDE.md: the deep rename is a separate deferred phase).
3. **Backend stays authoritative on permissions.** The frontend `rolePolicy` mirrors the gate/auto-fill rules for UX (show only what you can change), but the server still validates every create/update. The redesign must not loosen any gate.
4. **Preserve all current behavior**: the actor→target role rules, teamLead/manager auto-fill, `canCreate`/`canManage` gates, `acceptsTasks` decoupled from role.

## Chosen design (validated via visual brainstorm)

**Layout A — Directory + edit drawer.** One surface: a searchable/filterable/sortable users table is the hub;
clicking a row opens a right-side **edit drawer**; multi-selecting rows reveals a **bulk-action bar**;
**"Add users"** opens a create drawer. Hierarchy = **group-by only** (no separate tree).

### 1. Directory (the table)
- **Columns:** Name+Email (stacked), **Role** (colored badge, friendly label), **Team**, **Manager**, **Active** (inline toggle), **Accepts-tasks** (inline toggle), row `⋯`/click → drawer. **Team Lead** is the group header (not a column) under the default grouping; available as a column when grouping is off.
- **Toolbar:** search (name + email), filters (Role, Team, Active, Accepts-tasks), sort, **Group by** (Team Lead [default] / Team / Manager / none).
- **Inline quick-toggles:** Active and Accepts-tasks flip directly in the row (PUT `/api/users/bulk` with just that field) — no drawer needed. Gated by `rolePolicy` (disabled with tooltip if not allowed).
- **Selection → bulk-action bar:** "Set active/inactive", "Change team lead", "Change manager" (and role where allowed) applied to the selected set via `PUT /api/users/bulk`; only fields the actor may edit for the selected roles are offered.
- All client-side filter/sort/group over the already-fetched `manageable` list (small set); no new endpoints.

### 2. Edit drawer (per-user)
- Opens on row click. Header: name + email (read-only).
- Renders **only the fields the actor may change for that target**, driven by `rolePolicy`:
  - **editable** → control (Select/toggle/input). Role Select is limited to `canAssign[target]`.
  - **auto** → shown with the derived value + a hint ("auto-set from the team lead").
  - **locked** → read-only + 🔒 + reason ("managed by your role").
  - **hidden** → not rendered.
- Actions: **Save changes** (PUT `/api/users/bulk` for the one user), **Reset password**, **Cancel**. On save → optimistic row update + toast; reconcile from the response.

### 3. Add-users drawer
- Opens from "+ Add users". Two tabs: **Form** (single user; "+ Add another" to stack a few) and **Bulk paste** (paste emails/CSV → role/teamLead/manager auto-filled per `rolePolicy` → review → create).
- Both submit to `POST /api/users/bulk`. Field states come from the same `rolePolicy`. Result summary (created / failures) shown inline, then refetch.

### 4. `rolePolicy` config (the mess fix)
A single module describing, per **actor** role: which target roles they can create/assign, and each field's
state for a given target role. The drawer, the add-users form, the inline toggles, and the bulk bar all read it —
replacing the ~50 inline conditionals and the duplicated create/update logic. Shape:

```ts
// frontend/src/features/userManagement/rolePolicy.ts
type FieldState = 'editable' | 'auto' | 'locked' | 'hidden';
interface ActorPolicy {
  canAssign: LegacyRole[];                       // roles this actor may set on a target
  field(target: LegacyRole, field: 'role'|'team'|'teamLead'|'manager'|'active'|'acceptsTasks'): FieldState;
  autoValue?(target, field, ctx): string | boolean | undefined; // derived value for 'auto' fields
}
export const rolePolicy: Record<LegacyRole, ActorPolicy>;
```
It encodes the rules already in the current file (admin → all; mm → mam/mlead/recruiter with manager=self;
mam → mlead/recruiter with teamLead=self; am → lead/user; lead → user; mlead → recruiter; etc.).

### 5. Role label map (display only)
```ts
// frontend/src/features/userManagement/roleLabels.ts
export const roleLabel: Record<LegacyRole, string>; // mm→"Marketing Manager", mam→"Asst. Manager (Mktg)",
// mlead→"Team Lead (Mktg)", lead→"Team Lead (Tech)", am→"Asst. Manager (Tech)", user→"Expert", recruiter→"Recruiter", admin→"Admin"
export const roleBadgeTone: Record<LegacyRole, 'indigo'|'violet'|'emerald'|'blue'|'slate'|'amber'>;
```
Wire values are unchanged; this only affects rendering.

## Component breakdown (decompose the monolith)
`frontend/src/features/userManagement/`:
- `UserManagementPage.tsx` — orchestrator: fetch, state, compose the pieces. (Replaces the page; `pages/UserManagement.tsx` becomes a thin re-export.)
- `useManageableUsers.ts` — fetch + normalize (`toLegacyRole`) + refetch; client-side filter/sort/group helpers.
- `DirectoryToolbar.tsx` — search + filters + group-by + sort + "Add users".
- `UserTable.tsx` + `UserRow.tsx` — grouped table, badges, inline toggles, selection.
- `BulkActionBar.tsx` — appears on selection.
- `EditUserDrawer.tsx` — the per-user drawer (reads `rolePolicy`).
- `AddUsersDrawer.tsx` — form + bulk-paste tabs.
- `rolePolicy.ts`, `roleLabels.ts` — config + labels.
Uses existing shadcn primitives (Table, Sheet/Drawer, Dialog, Select, Badge, Switch, Checkbox, Command, Tooltip, Tabs).

## States & errors
- Loading skeleton on the table; error banner with retry on fetch failure; empty state when no users in scope.
- Inline-toggle / save failures: revert the optimistic change + destructive toast with the server error.
- Bulk results: per-row created/updated vs failures listed in the drawer/bar.

## Permissions (preserved)
- Page visible only to `canManage` roles (admin/mm/mam/mlead/lead/am); "Add users" only when `canCreate`.
- `rolePolicy` hides/locks fields the actor can't edit; the **server remains the source of truth** and rejects anything out of policy.

## Testing (Vitest)
- `rolePolicy` unit tests: for each actor, `canAssign` + field states match today's behavior (table-driven, mirrors the current rules).
- `roleLabels`: every legacy token maps to a label + tone.
- `EditUserDrawer`: renders only editable fields for a given actor→target; locked/auto shown with hints; Save PUTs the right payload.
- `AddUsersDrawer`: single + add-another + bulk-paste build the correct `POST /bulk` payload; field states from policy.
- `UserTable`: grouping, inline toggle PUTs the single field, selection → bulk bar; filter/search/sort.
- Reuse the existing logger-mock pattern if any new file imports a logger-bearing module.

## Out of scope
- Backend role rename / `team`-scoped BFS (C20 phase 2) — deferred, separate.
- Org-chart / dedicated hierarchy view (group-by covers it).
- Any change to `/api/users/*` contracts.

## Migration / rollout
Build the `features/userManagement/*` components alongside the old file; switch `pages/UserManagement.tsx` to render
the new `UserManagementPage`; delete the old body once parity is verified. No data-contract change → no backend deploy
coupling. Ship behind the same route; verify create/update/inline-toggle against a real session before merge.
