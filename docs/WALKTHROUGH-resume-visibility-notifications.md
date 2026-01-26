
# Walkthrough - Resume Visibility & Notification Fix

> **Goal**: Enable Read-Only access to Resume Understanding for management roles and fix "Unknown" user display in notifications.

## Changes

### 1. Backend: Notification Payload Enrichment
**File**: `backend/src/sockets/candidateSocket.js`
- Updated `handleAssignExpert` to fetch and attach `name` for `expert` and `recruiter` in the socket payload.
- Uses `userService.formatDisplayNameFromEmail` as a fallback if the user record relies on email.
- This resolves the issue where notifications displayed "Unknown candidate" or "Unknown expert".

### 2. Backend: Expanded RBAC
**File**: `backend/src/services/candidateService.js`
- Updated `getResumeUnderstandingQueue` and `getResumeUnderstandingCount` to allow:
  - `mam`
  - `mlead`
  - `mm`
  - `recruiter`
- These roles can now fetch queue data (Read-Access).

### 3. Frontend: Read-Only Views
**File**: `frontend/src/pages/ResumeUnderstanding.tsx`
- Added `mam`, `mlead`, `mm`, `recruiter` to the `allowed` list so the page loads.
- Exposed the `Completed` tab to these roles.
- **Critical**: Conditionally rendered "Mark Done" and "Mark Pending" buttons.
  - Buttons ONLY appear if:
    - User is `admin`
    - OR User is `expert`/`user` AND is the assigned expert (`candidate.expertRaw === userEmail`).
  - This prevents managers or recruiters from accidentally changing task status.

## Verification Results

### Automated Tests
- Created and ran `backend/test/verify_notification_payload.test.js` (Jest).
- Verified that `expert.name` and `recruiter.name` are correctly populated in the event payload even when missing from the DB record.

### Manual Validation Steps
1. **Log in as MAM/Recruiter**:
   - Go to `/resume-understanding`.
   - Verify you can see candidates.
   - Verify you CANNOT see the action buttons.
   - Open Discussion drawer to verify chat access.

2. **Notifications**:
   - Assign a candidate.
   - Check the toast notification.
   - It should read "Assigned to [Name]" instead of "Assigned to Unknown".
