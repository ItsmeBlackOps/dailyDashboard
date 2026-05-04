# CLAUDE.md

Operational guide for AI assistants (Claude Code, Codex, etc.) working in this repository. Read this before touching code.

> Last refreshed 2026-05-04. After the C20 phase 1 merge (PR #101). Update when the role rename completes phase 2 or when major subsystems are restructured.

---

## 1. What this is

**Daily Dashboard** is the internal dashboard for an interview-support recruiting business. It manages:

- A user/role hierarchy (managers, assistant managers, team leads, recruiters, experts).
- Candidates and their interview pipeline (status, debriefs, support requests, resume tailoring).
- A jobs pool aggregated from third-party scrapers (LinkedIn, ATS APIs via Apify) plus per-candidate job search sessions.
- PO email automation (Microsoft Graph), notifications, scheduled tasks, and daily/weekly digests.

Repo layout (top-level):

```
backend/          Express 5 + ESM, MongoDB (Atlas), Mongoose + raw driver mix.
frontend/         Vite + React 18 + TypeScript + Tailwind + shadcn/ui + Radix.
scraper/          Python scraper service (separate runtime).
forge-ai/         Resume Forge AI service (separate runtime).
resume-templates/ Static HTML/PDF resume templates.
nginx/            Blue/green gateway config.
scripts/          cicd-deploy.sh and rollback.sh.
docs/             Plan docs, walkthroughs, requirements.
```

Three runtimes are deployed via blue/green Docker Compose: backend (Node), frontend (static via nginx), gateway (nginx). The scraper and forge-ai run separately.

---

## 2. Tech stack and conventions

### Backend (`backend/`)

- **Node.js, ESM only.** `"type": "module"` in `package.json`. Never use `require()` — use `import`. Add `.js` extensions to relative imports (Node ESM requires it).
- **Express 5.** Routes live in `src/routes/*.js`, mounted from `src/routes/index.js`. Each route delegates to a controller in `src/controllers/`, which delegates to a service in `src/services/`. Services own all business logic; controllers are thin.
- **MongoDB.** Uses both the raw driver (`mongodb`) and `mongoose`. The raw driver is the convention for new collections. Models live in `src/models/`. Atlas is the prod database; cluster name is `interviewSupport`.
- **Auth.** JWT (access + refresh) via `src/middleware/auth.js`. Refresh tokens stored in `RefreshToken` collection. SSO via Microsoft (`@azure/msal-node`). Permission gates: `requireHTTPRole(['admin', 'manager', ...])`.
- **Logging.** Use `import { logger } from '../utils/logger.js'` — emits structured JSON. PostHog OpenTelemetry exporter is wired but optional (key may be missing locally).
- **Tests.** `npm test` runs Jest with experimental ESM. Many integration tests need an Atlas connection; they fail offline (`querySrv ECONNREFUSED`) but unit tests pass without a DB. Pre-existing failures in `userService.nameFormatting.test.js` and `userService.test.js` are mock-incompleteness from PR #98 (C9 validator) — do not assume they are caused by your changes; diff against `main` first.

### Frontend (`frontend/`)

- **Vite + React 18 + TypeScript.** `npm run dev` for local; `npm run build` for production.
- **UI.** Tailwind + shadcn/ui (in `src/components/ui/`) + Radix primitives. Lucide icons.
- **Auth.** MSAL (`@azure/msal-browser`/`@azure/msal-react`). Token attached via `src/lib/api*.ts` helpers.
- **Pages live in `src/pages/`.** Layouts in `src/components/layout/`. Domain components grouped by area (`jobs/`, `candidates/`, `tasks/`, `resume/`, etc.).
- **Tests.** Vitest. `npm test` runs all; targeted: `npx vitest run path/to/file.test.tsx`.

### Deploy

- Blue/green via `scripts/cicd-deploy.sh`. The script flips active color in `nginx/conf.d/upstreams/{frontend,backend}.active.conf` (these files are gitignored — they are VM-local state only).
- Rollback: `scripts/rollback.sh`.
- New Relic agent runs in both backend and frontend builds.

---

## 3. Domain model — read this before touching auth/permissions

### Roles (post C20 phase 1 merge)

The system is in a **dual-read window**: backend accepts both legacy and new role names. The migration script (`backend/scripts/c20-migrate-roles.mjs`) is ready but has not been run in prod at the time of this writing. Verify state via `mongosh` before assuming.

| Legacy name | New name (post-migration) | Level token |
|---|---|---|
| `admin` | `admin` | `admin` |
| `mm` | `manager` | `manager` |
| `mam` | `assistantManager` (team: marketing) | `assistantManager` |
| `am` | `assistantManager` (team: technical) | `assistantManager` |
| `mlead` | `teamLead` (team: marketing) | `teamLead` |
| `lead` | `teamLead` (team: technical) | `teamLead` |
| `recruiter` | `recruiter` | `recruiter` |
| `user` | `expert` | `expert` |

Helpers in `backend/src/services/userService.js`:
- `roleLevel(role)` — normalizes either form to a level token.
- `ROLES_ADMIN_OR_MANAGER`, `ROLES_PROVISIONERS`, etc. — superset arrays accepted by permission gates.
- `emitLegacyRoleWarning(role, source)` — logs a structured warn when a legacy name appears in a write path (used to track straggler clients during dual-read).
- `validateTeamLeadCompatibility(role, teamLeadName)` — enforces the role/teamLead hierarchy contract (PR #98 + C20).

**`team` field** (`technical` | `marketing` | `sales` | `null`). Admins are team-less. New users created without an explicit team inherit from the requester. Phase 2 will tighten BFS hierarchy walks to be team-scoped — until then, cross-team peeking is still possible.

### Hierarchy walks

`teamLead` is currently a **display-name string** (e.g. `"Brhamdev Sharma"`), not an email. BFS in `userService.isUserInRequesterHierarchy` and `candidateService.collectHierarchyEmails` traverses by matching display names derived from emails. C9 (validator) is in production; the full string→email migration is deferred — the validator gives most of the safety without the churn.

### Audit history

Every user mutation pushes a `changeHistory[]` entry via `userModel.updateUser`. The audited fields are listed in `User.js:AUDITED` — currently `['role', 'team', 'teamLead', 'manager', 'active']`.

---

## 4. Critical hot spots — touch carefully

### `backend/src/services/userService.js`
The largest service. Contains role enums, permission gates, BFS, validators, bulk create/update, hierarchy queries. **Most C-series audit work landed here.** Re-read the C20 phase 1 comment block before changing role logic.

### `backend/src/services/candidateService.js`
8 hierarchy-walk sites (line numbers documented in `user-mgmt-audit.html`). Any change to role/team semantics needs to be mirrored here.

### `frontend/src/pages/UserManagement.tsx`
50+ legacy role-string sites. **Frontend rename is intentionally deferred to a separate phase** — touching this file as part of a backend role change is out of scope. Display layer changes go through a label map.

### `nginx/conf.d/upstreams/{frontend,backend}.active.conf`
**Gitignored — VM-local state only.** A `git reset --hard` will not wipe them locally because git doesn't track them, but a fresh checkout has no such files. The cicd-deploy script writes them.

### `mongo-archive/`, `*-audit.html`, `po-dry-run.html`
**Gitignored — contain PII.** The repo is **public**. Never commit anything from these paths. Verify gitignore on every PR that adds DB exports or scratch HTML.

---

## 5. Workflow conventions

### Branching

```
main                         protected; PR-only.
fix/<short-name>             bug fixes.
feat/<short-name>            new features.
refactor/<short-name>        non-functional refactors.
```

PR title format: `<type>(<area>): <one-line>`. Example: `fix(jobs): stop defaulting unknown remote_type to 'remote'`.

### Commits

- Plain commit messages — subject + optional body.
- **No AI-attribution trailers.** Never add `Co-Authored-By: Claude`, `Generated with Claude Code`, or any similar trailer. This applies to direct commits AND any subagent dispatch — controller responsibility.
- Same rule for PR descriptions.

### Library research

When working with any third-party library/SDK/framework/CLI:

1. `mcp__context7__resolve-library-id`
2. `mcp__context7__query-docs`

Base implementation on retrieved docs, not training data. Skipping Context7 is a process failure.

### Brainstorm → plan → execute

For any non-trivial change, follow `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:subagent-driven-development` (or `executing-plans`). Do not skip the brainstorm gate, even for "simple" features. Plans live in `docs/superpowers/plans/`. Specs in `docs/superpowers/specs/`.

### Audit-driven backlog

User Management work is tracked in `user-mgmt-audit.html` (regenerated by hand; not auto-built). C-series items map to specific code locations. Status table at the top reflects what has shipped. Backlog cards include schema sketches, file paths, and concrete real-world examples (Tushar, Brhamdev, akash.avasthi, adnan.shaikh). Update the HTML whenever a C-item ships.

---

## 6. Recently shipped (May 2026)

- **PR #95** — Legacy role cleanup: dropped `manager`/`expert` from legacy enum, normalized data, lowercased everything.
- **PR #97** — C8: hierarchy-aware profile read (`isUserInRequesterHierarchy` BFS).
- **PR #98** — C9 (scoped) + C15: `validateTeamLeadCompatibility` validator + UI no longer silently overwrites teamLead on bulk role change.
- **PR #100** — Jobs list bug: stopped defaulting unknown `remote_type` to `'remote'`.
- **PR #101** — C20 phase 1: role rename + team field + dual-accept + migration script + monitoring.

## 7. Open backlog (see `user-mgmt-audit.html` for full detail)

- **C16** — pre-save validator at the model layer (rejects malformed teamLead strings, illegal role/team combos at write time).
- **C19** — Time-bound delegation (Share with TTL) + lateral peer Transfer. Replaces silent peer-on-peer access; formalizes Tushar's de-facto cross-MM reach.
- **C20 phase 2** — Tighten BFS to team-scoped + frontend deep rename (50+ sites). Run after Phase 1 has been verified in prod and migration has been applied.
- **C12** was dropped (peer cannot manage peer; lateral moves go through C19 Transfer instead).

---

## 8. Things that will bite you

- **Atlas is unreachable from some dev machines.** Tests that need a live DB will fail with `querySrv ECONNREFUSED`. Diff against `main` before assuming your change broke something.
- **`teamLead` is a string, not an email.** Display-name matching is fragile; the C9 validator catches most issues but a name typo still strands a user. Until C9 is upgraded to email FK, validate via the existing helpers.
- **The repo is public.** No PII, no secrets, no DB exports in git. Check `.gitignore` before adding files.
- **Blue/green deploy state files are gitignored.** Don't be alarmed when `git status` does not show changes after a deploy flip.
- **PostHog logs warn at startup if the API key is missing.** Not an error.
- **Permission gates accept legacy names during the dual-read window.** When you add a new gate, accept BOTH names (extend the appropriate constant in `userService.js`) — never accept only the new name until phase 2 lands.
