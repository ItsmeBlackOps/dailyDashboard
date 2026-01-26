# Plan: Notification System with History and Wide Reach

## Context
- **User Request**: "Notification Updates To All Users associated... keep the notification history in header notification option for a week"
- **Mode**: PLANNING ONLY
- **Goal**: Implement persistent notification history (1 week retention) and ensure status updates reach all associated stakeholders (Recruitment + Delivery + Admins).

## Task Breakdown

### Phase 1: Database Schema & Cleanup
- [ ] Create `backend/src/models/Notification.js`.
  - Fields: `recipient` (email), `type` (info, alert, etc.), `title`, `description`, `link`, `isRead`, `createdAt`, `expiresAt`.
  - TTL Index on `expiresAt` (7 days).
- [ ] Create `backend/src/services/notificationService.js`.
  - Methods: `createNotification(recipient, payload)`, `getNotificationsForUser(email)`, `markAsRead(notificationId)`.

### Phase 2: Enhanced Watcher Resolution
- [ ] Update `backend/src/services/candidateService.js`.
  - Implement `resolveAllWatchers(candidate)`:
    - Merge `resolveHierarchyWatchers` (Recruiter, MLead, MAM, MM).
    - Merge `resolveExpertHierarchy` (Expert, Lead, AM).
    - Add Admins.
    - Return unique list of emails.

### Phase 3: Socket & Persistence Integration
- [ ] Modify `backend/src/sockets/candidateSocket.js`.
  - In `handleUpdateStatus` and `handleAssignment`:
    - Use `resolveAllWatchers` to get recipients.
    - Loop through recipients:
      - Call `notificationService.createNotification` (Persist).
      - Emit socket event `notification:new` (Real-time).

### Phase 4: Frontend API & UI
- [ ] Update `frontend/src/context/NotificationContext.tsx`.
  - Add `fetchNotifications` on mount (call GET `/api/notifications`).
  - Update `markAsRead` to call backend API.
- [ ] Update `frontend/src/components/layout/Header.tsx`.
  - Ensure the notification bell uses the context correctly (already does, just need to verify it handles the persisted history format).

## Agent Assignments
- **Database/Backend**: `backend-specialist` (Schema, Service, Socket)
- **Frontend**: `frontend-specialist` (Context, API integration)

## Verification Checklist
- [ ] **Persistence**: Create a notification -> Reload page -> Notification is still there.
- [ ] **Retention**: Verify TTL index exists (7 days).
- [ ] **Reach**: multiple users (Recruiter, Expert, Admin) receive the *same* status update notification.
