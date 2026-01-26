
# Walkthrough - Comprehensive Resume Understanding Logic

> **Goal**: 
> 1. Restrict Candidate Creation (Only MM/Admin).
> 2. Fix Visibility for Management Roles (MM, MAM, MLEAD, Recruiter).
> 3. Implement Targeted Notifications (Recruiter -> MLead -> MAM -> MM).

## Changes Implemented

### 1. Creation Restriction
**File**: `backend/src/services/candidateService.js`
- **Updated `createCandidateFromManager`**:
  - Checks if role is `['admin', 'mm']`.
  - Throws `403` if User is Recruiter, Manager, MAM, or MLead.

### 2. Visibility Logic (Resume Queue)
**File**: `backend/src/models/Candidate.js`
- **Updated**: `getCandidatesByBranch` & `getCandidatesByRecruiters` to support `workflowStatus` and `resumeUnderstandingStatus` filtering.

**File**: `backend/src/services/candidateService.js`
- **Updated `getResumeUnderstandingQueue`**:
  - **MM**: Fetches by `Branch` (filtered by Status).
  - **MAM/MLEAD**: Fetches by `Hierarchy` (Recruiters) (filtered by Status).
  - **Recruiter**: Fetches by `Self` (filtered by Status).
  - **Expert/Lead/AM**: Remains fetched by `Assignment`.

### 3. Targeted Notifications
**File**: `backend/src/services/candidateService.js`
- **New Method**: `resolveHierarchyWatchers(candidate)`
  - Identifies Recruiter email.
  - Resolves MLead (Team Lead of Recruiter).
  - Resolves MAM (Manager of MLead).
  - Resolves MM (Branch Mapping).
  - Returns set of watchers.

**File**: `backend/src/sockets/candidateSocket.js`
- **Updated `handleAssignExpert`**: Notifies Hierarchy + Expert.
- **Updated `emitCommentNotifications`**: Notifies Hierarchy + Expert + Admin Chain.

## Verification Results

### Automated Tests
- **Backend Test**: `backend/test/comprehensive_roles.test.js`
  - ✅ **Creation Restriction**: Verified Recruiter blocked, MM allowed.
  - ✅ **Visibility**: Verified MM sees Branch candidates, MAM sees Hierarchy candidates.
  - ✅ **Notify**: Verified Hierarchy resolution correctly maps Recruiter -> MLead -> MAM -> MM.

### Manual Validation
- **MM View**: Login -> Resume Understanding -> See full branch list.
- **Recruiter View**: Login -> Resume Understanding -> See own candidates only.
- **Notifications**: Assigning expert triggers notification to Recruiter and their managers.
