# Project Plan: Realtime Tasks (Load Once, Stream Updates)

**Goal**: Eliminate "blinking" by implementing a robust real-time update system. The client will load data once and maintain state via socket events.

## Phase 1: Context & Analysis

-   **Problem**: Blinking, key churn, and invisible removals caused by rapid re-renders and lack of visibility diffing.
-   **Solution**: "Signal -> Fetch -> Upsert" pattern for client, and "Pre-Image Diffing" for backend.

## Phase 2: Implementation Breakdown

### Backend Tasks
1.  **[TaskModel] Implement Visibility Diffing**
    -   Update `setupChangeStream` to request `fullDocumentBeforeChange: "required"`.
    -   In `change` listener: extract `fullDocument` (new) and `fullDocumentBeforeChange` (old).
    -   Calculate `usersOld` = `usersWhoSawIt(oldDoc)`.
    -   Calculate `usersNew` = `usersWhoSeeItNow(newDoc)`.
    -   Calculate `removedFor` = `usersOld` - `usersNew`.
    -   Calculate `updatedFor` = `usersNew`.
2.  **[TaskSocket] Implement `taskRemoved` Event**
    -   Broadcast `taskRemoved` to users in `removedFor` set.
    -   Broadcast `taskUpdated` / `taskCreated` to users in `updatedFor` set.

### Frontend Tasks
1.  **[TasksToday] "Signal Only" Architecture**
    -   **Invalidation Queue**: On `taskCreated`/`taskUpdated`, do NOT apply the payload directly. Enqueue the `taskId`.
    -   **Canonical Fetch**: Process queue -> call `getTaskById(taskId)`.
    -   **Single Mutation**: Ideally apply one upsert per fetch to avoid flicker.
    -   **Stable Keys**: Verify `tasks` list uses `_id` as key (Confirmed).
    -   **Task Removal**: On `taskRemoved` event, remove from state immediately.
    -   **Notifications**: Trigger Sound/Toast as a side effect of the upsert (if status changed or new task added).

---

## Phase 3: Verification Plan

### Manual Verification
1.  **Zero Blinking Test**:
    -   Simulate update.
    -   Verify row updates in-place without list jumping or flashing white.
2.  **Removal Test**:
    -   Reassign a task away from current user.
    -   Verify task disappears instantly without refresh (via `taskRemoved` event).
3.  **Correctness**:
    -   Verify the fetched task data is the canonical data (includes all fields from aggregation like `candidateExpertDisplay`).
