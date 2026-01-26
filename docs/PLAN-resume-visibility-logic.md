
# Implementation Plan - Resume Visibility & Notification Logic Update

> **Goal**: 1) Fix Resume Understanding Queue visibility for MM/MAM/MLEAD/Recruiter (Branch/Hierarchy logic). 2) Ensure targeted notifications for these roles (Assignment, Comments, Status).

## User Review Required
> [!NOTE]
> **Visibility Change**:
> - **MM**: See candidates from Branch `GGR`/`LKN`/etc (mapped) in Resume Queue.
> - **MAM/MLEAD**: See candidates from their hierarchy (Recruiters) in Resume Queue.
> - **Recruiter**: See their own candidates.
>
> **Notification Change**:
> - **Noise Reduction**: Instead of broadcasting to ALL 'mam'/'mlead', notifications will be targeted to the *specific* managers in the candidate's hierarchy.

## Proposed Changes

### Backend - Visibility Logic
#### [MODIFY] [candidateModel.js](file:///root/dailyDashboard/backend/src/models/Candidate.js)
- Update `getCandidatesByBranch` to accept `workflowStatus` and `resumeUnderstandingStatus` options.
- Update `getCandidatesByRecruiters` to accept `workflowStatus` and `resumeUnderstandingStatus` options.

#### [MODIFY] [candidateService.js](file:///root/dailyDashboard/backend/src/services/candidateService.js)
- Update `getResumeUnderstandingQueue` & `getResumeUnderstandingCount`:
  - **MM**: Use `resolveBranchForMm` -> `getCandidatesByBranch` (filtered by status).
  - **MAM/MLEAD**: Use `collectHierarchyEmails` -> `getCandidatesByRecruiters` (filtered by status).
  - **Recruiter**: Use self-email -> `getCandidatesByRecruiters` (filtered by status).
- **New Helper**: `resolveHierarchyWatchers(candidate)`
  - Find Recruiter (from candidate).
  - Find Recruiter's TeamLead (MLead).
  - Find MLead's Manager (MAM).
  - Find Branch MM (via Branch map).
  - Returns list of emails.

### Backend - Notification Logic
#### [MODIFY] [candidateSocket.js](file:///root/dailyDashboard/backend/src/sockets/candidateSocket.js)
- Update `emitCommentNotifications`:
  - Parse candidate hierarchy using `candidateService.resolveHierarchyWatchers`.
  - Emit to those specific users instead of broadcasting to entire roles (if possible) or ensure they are added to the recipient list.
- Update `handleAssignExpert`:
  - Emit 'candidateExpertAssigned'/'resumeUnderstandingAssigned' to the resolved hierarchy watchers.
- Update `handleResumeUnderstanding` & `handleUpdateStatus`:
  - Ensure hierarchy watchers are notified.

### Frontend
#### [MODIFY] [NotificationContext.tsx](file:///root/dailyDashboard/frontend/src/context/NotificationContext.tsx)
- Verify `handleAssignment`, `handleNewComment`, `handleStatusUpdate` display correct messages for these roles.
- Ensure "Unknown" fallback logic is present (already done in previous plan, but double check).

## Verification Plan

### Automated Tests
- Create `backend/test/resume_notifications.test.js`.
- Test cases:
  - `resolveHierarchyWatchers`: Verify it correctly identifies the chain for a given candidate.
  - Notification Emission: Verify that for a candidate `X` (Recruiter: A), User `B` (MLead of A) receives the notification.

### Manual Verification
1. **Visibility**: as defined previously.
2. **Notifications**:
   - Login as `MAM`.
   - Have a Recruiter (subordinate) create a candidate.
   - Have an Admin assign an Expert.
   - Verify `MAM` gets the assignment notification.
   - Have Expert comment.
   - Verify `MAM` gets comment notification.
