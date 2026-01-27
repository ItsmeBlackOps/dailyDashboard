# Plan: Permissions and Toast Fixes

## Context
- **User Request**: Fix permissions for MAM, mlead, mm to send support/assessment/RU requests if candidates are visible. Fix missing toast notifications.
- **Current State**:
    - `canSendSupport` checks specific roles but might be flaky or incomplete.
    - `<Toaster />` is missing from `App.tsx`, causing notifications to be invisible.
    - Toast route is incorrectly defined as `/toast`.

## Task Breakdown

### 1. Fix Toast Notifications
- **Status**: Identified root cause (Missing `<Toaster />` component).
- **Action**:
    - Import `Toaster` from `components/ui/toaster`.
    - Add `<Toaster />` to `App.tsx` (globally, outside Routes).

### 2. Fix Permissions for MAM/MLead/MM
- **Status**: Logic exists but needs verification/relaxation.
- **Action**:
    - Update `canSendSupport` in `BranchCandidates.tsx`.
    - Ensure it encompasses `recruiter`, `mlead`, `mam`, `mm` and potentially `lead` or `manager` aliases if permissions are role-based.
    - Since "if it's visible... they can create", we should ensure that if the user has access to `BranchCandidates` (which is gated by route authentication), they effectively have these actions enabled, or at least specifically for these management roles.

### 3. Verification
- **Manual**:
    - Check if "Status Updated" toast appears.
    - Check if "Support Sent" toast appears.
    - Verify buttons are visible for target roles.

## Agent Assignments
- **Orchestrator**: Updates `App.tsx` and `BranchCandidates.tsx`.

## Verification Checklist
- [ ] `<Toaster />` added to App.tsx
- [ ] Toast notifications visible on action
- [ ] Support/Assessment/RU buttons visible for MAM/MLead/MM
