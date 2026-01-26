# PostHog Tracking Plan for Remaining Modules

## 1. Overview
This plan covers the remaining core areas requested: **Branch Candidates**, **Resume Understanding**, **User Management**, and **Sidebar Navigation**.

## 2. Event Matrix

### 2.1 Sidebar (Navigation)
**Event Name**: `sidebar_navigation_clicked`
*   **Trigger**: Click on any sidebar link.
*   **Properties**:
    *   `destination`: The href path (e.g., `/tasks`, `/branch-candidates`).
    *   `label`: The visible label (e.g., "Tasks").
    *   `user_role`: User's role.

### 2.2 Branch Candidates
**Event Name**: `branch_candidates_viewed`
*   **Trigger**: When the Branch Candidates page mounts.
*   **Properties**:
    *   `user_role`: User's role.
    *   `default_scope`: Initial scope loaded.

**Event Name**: `branch_scope_changed`
*   **Trigger**: When the user changes the scope (Branch vs Hierarchy vs Expert).
*   **Properties**:
    *   `scope_type`: `branch`, `hierarchy`, or `expert`.
    *   `scope_value`: The selected value (e.g., "NJ", "John Doe").

### 2.3 Resume Understanding
**Event Name**: `resume_understanding_viewed`
*   **Trigger**: When the page mounts.
*   **Properties**:
    *   `user_role`: User's role.

**Event Name**: `resume_tab_changed`
*   **Trigger**: Switching between "Pending" and "Completed".
*   **Properties**:
    *   `tab`: `pending` | `done`.

*(Note: `resume_queue_processed` is already implemented)*

### 2.4 User Management
**Event Name**: `user_management_viewed`
*   **Trigger**: When the page mounts.
*   **Properties**:
    *   `user_role`: User's role.

*(Note: `admin_bulk_user_action` is already implemented)*

## 3. Implementation Plan
1.  **Sidebar.tsx**: Inject `usePostHog` and add `onClick` tracking to `NavItem`.
2.  **BranchCandidates.tsx**: Add `useEffect` for view tracking and scope change tracking.
3.  **ResumeUnderstanding.tsx**: Add `useEffect` for view metrics and tab switching.
4.  **UserManagement.tsx**: Add `useEffect` for view metrics.
