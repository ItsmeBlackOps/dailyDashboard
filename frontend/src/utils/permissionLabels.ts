// Auto-generated permission labels for comprehensive permissions
// This converts permission keys like 'tasks_view_expert_column' to 'View Expert Column'

export function generatePermissionLabel(permission: string): string {
    // Handle special cases
    const specialLabels: Record<string, string> = {
        dashboard_view_overview_tab: 'Dashboard Overview Tab',
        dashboard_view_recruiter_stats_tab: 'Dashboard Recruiter Stats Tab',
        dashboard_view_expert_stats_tab: 'Dashboard Expert Stats Tab',
        dashboard_view_management_reports_tab: 'Dashboard Management Reports Tab',
    };

    if (specialLabels[permission]) {
        return specialLabels[permission];
    }

    // Auto-generate from snake_case
    return permission
        .split('_')
        .map((word, index) => {
            // Capitalize first letter of each word
            return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ')
        .replace(/^(Dashboard|Tasks|Candidates|Resume|Users|Reports|Alerts|Profile|Notifications|System|Meetings)\s/, (match) => {
            // Add prefix separator
            return match.trim() + ': ';
        });
}

// Category display names
export const CATEGORY_LABELS: Record<string, string> = {
    dashboard_overview: 'Dashboard Overview',
    tasks_view: 'Tasks - View & Columns',
    tasks_filters: 'Tasks - Filters',
    tasks_actions: 'Tasks - Actions',
    candidates_view: 'Candidates - View & Columns',
    candidates_edit: 'Candidates - Edit',
    candidates_filters: 'Candidates - Filters & Actions',
    resume_view: 'Resume - View',
    resume_actions: 'Resume - Actions',
    resume_filters: 'Resume - Filters',
    users_view: 'Users - View',
    users_create: 'Users - Create',
    users_edit: 'Users - Edit',
    users_filters: 'Users - Filters & Actions',
    other: 'Other Permissions'
};
