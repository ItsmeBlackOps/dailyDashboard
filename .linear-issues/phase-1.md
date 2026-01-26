# Issue: Implement backend support for enhanced notification details

## Context
Users currently receive generic notifications (e.g., "Status Updated") without details of what changed. To support the new Enhanced Notification UI, the backend needs to capture and persist granular change data.

## Goal
Update backend systems to track old values, new values, and actor details for candidate updates and bulk operations.

## Scope
- Update `Notification` schema to include `changeDetails` and `actor`
- Update `candidateService` to capture field changes (old vs new)
- Update `candidateSocket` to pass change details for status/bulk updates
- Update `notificationDeliveryWorker` and `orchestrator` to persist these details

## Non-scope
- Frontend UI changes (Phase 2)

## Acceptance Checks
- [ ] `notifications` collection documents include `changeDetails` object
- [ ] `changeDetails` contains `oldValue`, `newValue`, `changedFields`
- [ ] Bulk updates include `bulkCandidates` array with per-candidate changes
- [ ] Notifications include `actor` object with email/name/role
- [ ] Existing notification flows still work without errors

## Labels
backend, feature, notif-ui
