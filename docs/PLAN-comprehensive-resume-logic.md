
# Implementation Plan - Comprehensive Resume Logic Update

> **Goal**: 
> 1. Enforce "Only MM can create candidates" rule.
> 2. Fix Resume Understanding visibility for Management roles (MM, MAM, MLEAD) & Recruiters.
> 3. Implement targeted notification hierarchy (Recruiter -> MLead -> MAM -> MM).

## 1. Candidate Creation Restriction
> **Code**: `backend/src/services/candidateService.js` -> `createCandidateFromManager`

**Current State**: Allows `[, 'admin', 'mm']`.
**New State**: Restrict to `['mm', 'admin']`. (Admin retained for system maintenance).
- Recruiters, MAM, MLEAD cannot create candidates via this flow.

## 2. Resume Understanding Visibility
> **Code**: `backend/src/services/candidateService.js` -> `getResumeUnderstandingQueue` / `getResumeUnderstandingCount`
> **Code**: `backend/src/models/Candidate.js` -> `getCandidatesByBranch` / `getCandidatesByRecruiters`

**Logic Update**:
The current implementation works well for *Experts* (Lead/AM/User) but fails for *Marketing* (MM/MAM/MLead/Recruiter) because it treats them as experts looking for assignments.

**New Logic Table**:
| Role | Data Source | Filter |
|------|-------------|--------|
| **MM** | `getCandidatesByBranch` | `branch` + `status` |
| **MAM** | `getCandidatesByRecruiters` | `hierarchy(recruiters)` + `status` |
| **MLEAD** | `getCandidatesByRecruiters` | `hierarchy(recruiters)` + `status` |
| **Recruiter** | `getCandidatesByRecruiters` | `self` + `status` |
| **Expert/Lead** | `getCandidatesForExperts` | `assigned_emails` + `status` |

**Implementation Details**:
1. Update `CandidateModel` methods to accept `workflowStatus` and `resumeUnderstandingStatus`.
2. Refactor `getResumeUnderstandingQueue` to switch logic based on role.

## 3. Targeted Notifications
> **Code**: `backend/src/services/candidateService.js` -> `resolveHierarchyWatchers` (New Helper)
> **Code**: `backend/src/sockets/candidateSocket.js`

**Hierarchy Resolution**:
For a given candidate:
1. Identify **Recruiter** (source owner).
2. Identify **MLead** (Recruiter's Team Lead).
3. Identify **MAM** (MLead's Manager).
4. Identify **MM** (Branch Head via Branch Map).

**Triggers**:
- `candidateExpertAssigned`: Notify Hierarchy + Expert.
- `newComment`: Notify Hierarchy + Expert (if not sender).
- `resumeUnderstandingUpdated`: Notify Hierarchy + Expert.

## 4. Frontend Alignment
> **Code**: `frontend/src/pages/ResumeUnderstanding.tsx`
> **Code**: `frontend/src/context/NotificationContext.tsx`

- **ResumeUnderstanding.tsx**: Ensure columns (Recruiter, Branch, Expert) are visible/relevant for these roles. Status change controls remain hidden (Read-Only).
- **NotificationContext.tsx**: Ensure text is appropriate for "Manager View" (already partially implemented, will review).

## Verification Plan

### Automated Tests
- `backend/test/comprehensive_roles.test.js`:
  - **Creation**: Verify `manager` cannot create, `recruiter` cannot create. `mm` can.
  - **Visibility**: 
    - Verify `MM` sees branch candidates.
    - Verify `MAM` sees team candidates.
  - **Notifications**:
    - Verify hierarchy resolution returns correct emails.

### Manual Verification
1. **Creation**:
   - Login as `Recruiter` -> Verify no create option or API fails.
   - Login as `MM` -> Verify create works.
2. **Visibility**:
   - Login as `MM` -> Check Resume Understanding tab.
   - Login as `Recruiter` -> Check Resume Understanding tab.
3. **Flow**:
   - Admin assigns Expert -> Verify MM/Recruiter get notification.
