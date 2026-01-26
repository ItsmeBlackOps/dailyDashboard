
# Implementation Plan - Resume Visibility & Notifications

> **Goal**: Expand Resume Understanding visibility to management roles (Read-Only) and fix "Unknown" user issues in Notifications.

## User Review Required
> [!IMPORTANT]
> **Read-Only Access**: MM, MAM, MLead, and Recruiter will be able to *view* the Resume Understanding page and discussions, but will NOT be able to change the status (Blocked by backend and hidden on frontend).

## Proposed Changes

### Backend
#### [MODIFY] [candidateSocket.js](file:///root/dailyDashboard/backend/src/sockets/candidateSocket.js)
- Update `handleAssignExpert` to enrich `expertUser` and `recruiterUser` with a `name` property.
- Use `userService.formatDisplayNameFromEmail` or similar logic to populate the name if missing from the user record.
- Update `handleNewComment` if needed (it uses `comment.author.name`).

#### [MODIFY] [candidateService.js](file:///root/dailyDashboard/backend/src/services/candidateService.js)
- Ensure `getResumeUnderstandingQueue` allows MM, MAM, MLead, Recruiter (Already applied in previous debug step, verifying).

### Frontend
#### [MODIFY] [ResumeUnderstanding.tsx](file:///root/dailyDashboard/frontend/src/pages/ResumeUnderstanding.tsx)
- Add `mm`, `mam`, `mlead`, `recruiter` to the `allowed` roles list.
- Add logic to hide/disable "Mark Done" / "Mark Pending" buttons if the user is NOT Admin and NOT the assigned Expert.
- Ensure the Discussion drawer is accessible (it uses `selectedCandidate` state, so it should work if table renders).

#### [MODIFY] [NotificationContext.tsx](file:///root/dailyDashboard/frontend/src/context/NotificationContext.tsx)
- (Optional) Add fallback logic for `name` if backend payload is still missing it, to prevent "Unknown" display.

## Verification Plan

### Automated Tests
- Run backend tests to verify notification payloads (using `repro_notification.test.js` - will create).

### Manual Verification
1. **Resume Understanding Visibility**:
   - Login as `MAM` or `Recruiter`.
   - Navigate to `/resume-understanding`.
   - Verify page loads with candidates.
   - Verify "Mark Done" buttons are hidden or disabled.
   - Click "Discussion" icon and verify chat works.

2. **Notifications**:
   - Trigger an expert assignment.
   - Check notification toast and list.
   - Verify "Unknown Candidate" and "Unknown Expert" are replaced with actual names.
