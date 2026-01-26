# Plan: Bulk Notification Details & Grouping

## Context
- **User Request**: "notification for bulk tasks... on click... we can get more details"
- **Mode**: PLANNING ONLY
- **Goal**: Consolidate bulk actions into single notifications and provide a detailed view (modal) when clicked.

## Problem
Currently, bulk actions (like updating 10 candidates) trigger 10 separate notifications. This is noisy and makes it hard to review the overall action.

## Brainstorm Options
- **A) Frontend Grouping**: Client aggregates individual socket events. Flaky and doesn't solve persistent history clutter.
- **B) Search Filter Link**: Notification links to a filtered list (e.g. `?ids=1,2,3`). Good, but URL length limits apply.
- **C) Backend Batching + Detail Modal (Recommended)**: 
  - Send one bulk command.
  - Backend creates one "Batch Notification".
  - Click opens a modal with a summary table.

## Task Breakdown

### Phase 1: Backend Bulk Operations
- [ ] Implement `candidateSocket` events for:
  - `bulkUpdateCandidateStatus` (Payload: `ids: [], status`)
  - `bulkAssignCandidateExpert` (Payload: `ids: [], expert`)
- [ ] Update `NotificationService` to support `createBatchNotification`.
  - Schema Additions: `batchData` (Array of summary objects `{id, name, status}`).

### Phase 2: Frontend Notification UI
- [ ] Create `NotificationDetailsDialog.tsx`.
  - Props: `notificationDescription`, `batchData`.
  - Renders a simple Table of affected items.
- [ ] Update `Header.tsx` / `NotificationContext.tsx`.
  - Handle `type: 'batch'`.
  - On click -> Open Dialog instead of navigating.

### Phase 3: Update Bulk Actions
- [ ] Modify `BranchCandidates.tsx`:
  - `handleBulkStatusUpdate` -> Call new `bulkUpdateCandidateStatus` socket event instead of looping.

## Agent Assignments
- **Backend**: `backend-specialist` (Socket, Service)
- **Frontend**: `frontend-specialist` (Modal, Context)

## Verification Checklist
- [ ] **Noise Reduction**: Select 5 candidates -> Update -> Receive **1** Notification (not 5).
- [ ] **Detail View**: Click notification -> Modal opens -> Shows 5 names and new status.
- [ ] **Persistence**: Reload page -> Batch notification persists -> Click still opens modal.
