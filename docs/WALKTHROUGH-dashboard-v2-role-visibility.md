# Walkthrough - Dashboard V2 Role Visibility

> **Goal**: Document tab visibility and access expectations for Recruiter Stats and Expert Stats so role changes do not drift.

## Source of Truth
- UI gating lives in `frontend/src/pages/DashboardV2.tsx`.
- Data endpoints live in `backend/src/controllers/dashboardController.js` (stats + drilldowns).

## Tab Visibility (UI)
- **Overview**: all authenticated roles.
- **Recruiter Stats**: `admin`, `recruiter`, `manager`, `mlead`, `mam`, `mm`.
- **Expert Stats**: `admin`, `user` (expert), `lead`, `am`.
- **Management Reports**: `admin`, `mlead`, `lead`, `mam`, `am`, `mm`, `recruiter`, `user`.

## Guardrails
- Role checks normalize to lowercase; keep allow-lists lowercase.
- `user` is the expert role label used in auth; backend also recognizes `expert`.
- These lists are UI-only gates today. The dashboard stats endpoints authenticate but do not hard-block roles.
- `manager` is not covered by `getScopedMatchForTasks`, so adding/keeping it in the UI allow-list
  without backend RBAC can expose broader data.
- If you change any role list, update:
  - `frontend/src/pages/DashboardV2.tsx`
  - `backend/src/controllers/dashboardController.js` (role allow-lists for stats + drilldowns)
  - `README.md` (Dashboard V2 access summary)
  - Unit tests for the controller endpoints
