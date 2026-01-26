# Issue: Implement Notification Detail Modal and Enhanced UI

## Context
Backend now supports `changeDetails` and `actor`. Frontend needs to display this information in a friendly way (Modal) instead of simple toasts.

## Goal
Create `NotificationDetailModal` and enhance `Header` notification list to support detailed views.

## Scope
- Create `NotificationDetailModal` component
- Create `BulkUpdateDetails` component
- Create `StackedToast` component
- Update `NotificationContext` with modal state
- Wire up `Header` to open modal on click
- Add "Mark all as read" logic

## Non-scope
- Backend changes (Done in Phase 1)

## Acceptance Checks
- [ ] Clicking a notification opens a modal with details
- [ ] Status updates show Old -> New value
- [ ] Bulk updates show breakdown of affected candidates
- [ ] Interview reminders appear as stacked toasts
- [ ] "Mark all as read" marks all visible notifications as read
- [ ] Modal has "View Candidate" button working

## Labels
frontend, feature, notif-ui
