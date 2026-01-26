# PostHog Tracking Plan for Tasks Tab

## 1. Overview
This plan defines the event tracking matrix for the **Tasks Today** page (`/tasks`). This page is the operational hub for Recruiters and Leads. We aim to track:
1.  **Workload Volume**: How many tasks are being loaded?
2.  **Filter Usage**: Are users filtering by Status/Candidate?
3.  **Feature Usage**: Adoption of "Mock Request", "Support Clone", "Thanks Mail", and "Meeting Join".
4.  **Operational Efficiency**: Task deletion and meeting attendance.

## 2. Event Matrix

### 2.1 Page View
**Event Name**: `tasks_viewed`
*   **Trigger**: When the Tasks page mounts.
*   **Properties**:
    *   `user_role`: User's role.
    *   `default_range`: The time range loaded by default (usually "day").
    *   `tasks_coun_initial`: Number of tasks loaded (if possible to capture after load).

---

### 2.2 Filter Usage (Local Filters)
**Event Name**: `tasks_filter_changed`
*   **Trigger**: When user changes the "Status" dropdown or types in "Candidate/Recruiter/Expert" search inputs (debounced or on blur).
*   **Properties**:
    *   `filter_type`: `status`, `candidate_search`, `recruiter_search`, `expert_search`.
    *   `value`: The selected status or presence of search text (boolean `has_search_term` is safer for PII than raw text, though raw text is acceptable if not sensitive).
    *   `status_value`: If `filter_type` is status, the specific value (e.g., `Scheduled`, `Completed`).

*(Note: Global Date Range changes are already tracked by `dashboard_filter_changed` component event if we reused the logic, but usually `DashboardFilters` is strictly Dashboard. If `TasksToday` uses `DashboardFilters`, we get this for free. If it implements its own logic, we track it here.)*

---

### 2.3 Task Actions
**Event Name**: `task_action_performed`
*   **Trigger**: Specific button clicks on task rows.
*   **Properties**:
    *   `action_type`:
        *   `delete`: Clicking Delete (Confirm).
        *   `join_meeting`: Clicking "Join" or "Copy Link".
        *   `clone_support`: Draft support ticked.
        *   `request_mock`: Mock interview requested.
        *   `generate_thanks`: Thanks mail generated.
        *   `generate_questions`: Interview questions generated.
    *   `task_status`: Status of the task being acted upon.
    *   `task_technology`: Technology tag of the task.

---

### 2.4 Feature-Specific Flows
**Event Name**: `mock_request_submitted`
*   **Trigger**: Successfully submitting the Mock Request dialog.
*   **Properties**: `technology`, `candidate_id` (hashed or raw).

**Event Name**: `thanks_mail_generated`
*   **Trigger**: Successfully generating a Thanks Mail.
*   **Properties**: `template_type` (if applicable).

---

## 3. Implementation Notes
*   **Global Props**: Ensure `user_role` and `branch` are sent with all events (using the `usePostHog` context or explicit props).
*   **Debounce**: For Search inputs (Candidate/Recruiter), purely capturing `onChange` is too noisy. Track `onBlur` or use a `useDebounce` effect to capture the final search term.
*   **PII**: Be careful tracking raw "Candidate Name" in search terms if strict GDPR is required. For now, tracking "search term length" or just "is_searching: true" might be sufficient, but "search_term" is usually fine for internal CRM tools.
