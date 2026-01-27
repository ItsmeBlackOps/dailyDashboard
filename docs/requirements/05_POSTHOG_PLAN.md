# PostHog Tracking Plan for Dashboard Overview Page

## 1. Overview
This plan defines the event tracking matrix for the **Dashboard Overview** page. The goal is to gain deep insights into user behavior, specifically focusing on:
1.  User Engagement (Who is visiting?).
2.  Role Analysis (Which roles are most active?).
3.  Feature Usage (Which filters are used most?).
4.  Component Visibility (Engagement with KPIs/Charts).

## 2. Global Properties
These properties must be sent with **EVERY** event to allow for user/role filtering.
*(Note: PostHog `identify` call handles $user_id and $email automaticlly, but we explicitly track role for easier filtering)*

| Property | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `user_role` | String | Role of the user accessing the dashboard | `admin`, `recruiter`, `expert` |
| `branch` | String | Branch of the user (if applicable) | `Ahmedabad` |

## 3. Event Matrix

### 3.1 Page View Interaction
**Event Name**: `dashboard_viewed`
*   **Trigger**: When the Dashboard Overview (`/`) mounts.
*   **Description**: Tracks initial landing on the dashboard.

| Property | Type | Description |
| :--- | :--- | :--- |
| `initial_tab` | String | Which date field tab is active on load |
| `is_mobile` | Boolean | True if accessed via mobile breakpoint |

---

### 3.2 Filter Usage (Detailed)
**Event Name**: `dashboard_filter_changed`
*   **Trigger**: When any filter in `DashboardFilters` component is updated.
*   **Description**: Captures exactly what data slice the user is looking at.

| Property | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `filter_type` | String | Which filter was changed | `range`, `date_field`, `upcoming_toggle` |
| `range_selected` | String | The new range value | `day`, `week`, `month`, `custom` |
| `date_field` | String | field being filtered on | `Date of Interview`, `receivedDateTime` |
| `start_date` | String | ISO Date String (if range active) | `2026-02-01T00:00:00.000Z` |
| `end_date` | String | ISO Date String (if range active) | `2026-02-01T23:59:59.999Z` |
| `is_upcoming` | Boolean | State of "Upcoming Only" toggle | `true`/`false` |

---

### 3.3 KPI Interaction (Overall Interviews)
**Event Name**: `dashboard_kpi_interaction`
*   **Trigger**: When user interacts with the KPI Overview component (e.g., changing internal filters like Round/Branch if applicable, or purely on load to track impression with context).
*   **Description**: Tracks visibility of the main KPI charts.

| Property | Type | Description |
| :--- | :--- | :--- |
| `rounds_filter` | Array<String> | List of selected rounds in the multi-select |
| `branch_filter` | Array<String> | List of selected branches (Admin only) |
| `total_count` | Number | The total "Overall" count displayed (helps correlate data volume with interest) |

---

### 3.4 Top Agents Interaction
**Event Name**: `dashboard_top_agents_viewed`
*   **Trigger**: When filters change (refreshing the list) or view mode changes.
*   **Description**: Tracks how users analyse agent performance.

| Property | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `view_mode` | String | The active tab in Top Agents | `expert`, `recruiter`, `candidate` |
| `agents_count` | Number | Number of agents listed | `15` |
| `agent_search_term`| String | If user searched for a specific agent | `harsh` |

---

## 4. Implementation Guide (Frontend)

### 4.1 Hooks
Use the `usePostHog` hook from `posthog-js/react`:

```typescript
const posthog = usePostHog();

// Example: Dashboard Load
useEffect(() => {
    posthog.capture('dashboard_viewed', {
        user_role: user.role,
        initial_tab: filters.dateField
    });
}, []);

// Example: Filter Change (Inside DashboardFilters.tsx)
const handleRangeChange = (value: DashboardRange) => {
    // ... logic ...
    posthog.capture('dashboard_filter_changed', {
        user_role: user.role,
        filter_type: 'range',
        range_selected: value,
        // ... include current state of other filters
    });
};
```
