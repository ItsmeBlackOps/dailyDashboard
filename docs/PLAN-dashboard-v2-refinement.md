# PLAN-dashboard-v2-refinement.md

## Goal
Refine Dashboard V2 logic to fix data fetching issues for MM role, correct visibility logic for team leaders (mlead/mam), and enhance Management Reports with detailed drill-downs.

## User Review Required
> [!IMPORTANT]
> **Logic Update**: Management Reports will now flag candidates with **< 3 interviews in the last 30 days** (previously 0).
> **Role Logic**: `mlead` (Manager Lead) will be treated similarly to `lead` for team fetching. `mm` (Branch Manager) will match Branch case-insensitively.

## Proposed Changes

### Backend

#### [MODIFY] [dashboardController.js](file:///root/dailyDashboard/backend/src/controllers/dashboardController.js)
- **Overview Stats**:
    - `totalCandidates`: Use *scoped* candidate count (Total Scoped), do NOT filter by status.
    - `activeCandidates`: Use *scoped* candidate count (Active Scoped).
- **Drilldown**:
    - Update `getManagementDrilldown` (if needed) and add/update logic for Recruiter/Expert drilldowns if they use separate endpoints or re-use `taskService`.
    - Ensure fields: `Candidate Name`, `Date of Interview`, `Start Time Of Interview`, `Interview Round`, `status`, `Actual Round`.

### Frontend

#### [MODIFY] [DashboardV2.tsx](file:///root/dailyDashboard/frontend/src/pages/DashboardV2.tsx)
- **Role Visibility**:
    - Remove `manager`, `mlead`, `lead`, `mam`, `am`, `mm`, `recruiter` from `Expert Stats` tab trigger.
- **Date Picking**:
    - Implement granular controls using `Popover` (from `DashboardFilters.tsx` pattern) or similar.
    - Month Picker: Year dropdown + Month dropdown.
    - Week Picker: Month dropdown + Week dropdown.
    - Day Picker: Calendar popover.

#### [MODIFY] [RecruiterAnalytics.tsx](file:///root/dailyDashboard/frontend/src/components/dashboard/v2/RecruiterAnalytics.tsx)
- Add `Dialog` logic similar to `ManagementReports`.
- Make chart bars / table rows clickable.
- Fetch tasks on click (endpoint: `/api/dashboard/stats/recruiter/drilldown` or similar? Or re-use a generic task search?). 
    - *Plan*: Create a new generic drilldown endpoint or use existing search with specific filters? A dedicated lightweight endpoint is better for speed.

#### [MODIFY] [ExpertAnalytics.tsx](file:///root/dailyDashboard/frontend/src/components/dashboard/v2/ExpertAnalytics.tsx)
- Add `Dialog` for drill-down (similar fields).

### Verification
- **Recruiter**: Check `Recruiter Stats` popup. Check `Expert Stats` is hidden. Check Overview counts.
- **MM/Branch (Tushar)**: Check active vs total counts in Overview.
- **General**: Test Date Picker modes.

## Verification Plan

### Automated Tests
- None (logic changes rely on data).

### Manual Verification
1. **MM View**: Login as MM, verify "Management Reports" and "Recruiter Stats" show data for the branch.
2. **MLead View**: Login as MLead, verify "Recruiter Stats" shows their team members (not just themselves, and not the MAM's name as the lead).
3. **Management Reports**:
    - Verify candidates with 1 or 2 interviews appear.
    - Click a candidate row -> Verify modal opens with task list.
