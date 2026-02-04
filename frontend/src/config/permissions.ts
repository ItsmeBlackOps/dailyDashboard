// Normalized RBAC Permission Model
// Uses capability-based permissions (resource:action) + scopes (own/team/any)
// NO field-level PII permissions - access controlled at resource level

// ===== CAPABILITY PERMISSIONS (resource:action) =====
export const CAPABILITY_PERMISSIONS = {
    // Dashboard
    'dashboard:read': 'View Dashboard',

    // Tasks
    'tasks:read': 'View Tasks',
    'tasks:write': 'Create/Edit Tasks',
    'tasks:assign': 'Assign Tasks to Experts',
    'tasks:meeting': 'Manage Meetings',
    'tasks:delete': 'Delete Tasks',
    'tasks:support': 'Clone Support Tasks',
    'tasks:mock': 'Request Mock Interviews',

    // Candidates
    'candidates:read': 'View Candidates',
    'candidates:write': 'Create/Edit Candidates',
    'candidates:delete': 'Delete Candidates',
    'candidates:export': 'Export Candidates',
    'candidates:import': 'Import Candidates',

    // Resumes
    'resumes:read': 'View Resumes',
    'resumes:review': 'Review Resumes (Update Status/Reject/Complete)',
    'resumes:assign': 'Assign Resumes to Experts',
    'resumes:download': 'Download Resumes',

    // Users
    'users:read': 'View Users',
    'users:manage': 'Manage Users (Create/Edit/Delete)',
    'users:roles': 'Manage User Roles',

    // Reports
    'reports:read': 'View Reports',
    'reports:export': 'Export Reports',
    'reports:schedule': 'Schedule Reports',

    // Admin Alerts
    'alerts:manage': 'Manage Admin Alerts',

    // System
    'system:settings': 'Access System Settings',
    'audit:read': 'View Audit Logs',

    // Notifications
    'notifications:read': 'View Notifications',
    'notifications:manage': 'Manage Notification Preferences',

    // Profile
    'profile:read': 'View Own Profile',
    'profile:write': 'Edit Own Profile',

    // Permissions (admin only)
    'permissions:manage': 'Manage Role Permissions',
};

// ===== SCOPE MODIFIERS (ABAC-style) =====
export const SCOPES = {
    'scope:own': 'Own Records Only',
    'scope:team': 'Team Records',
    'scope:any': 'All Records (No Restrictions)',
};

// ===== PERMISSION CATEGORIES FOR UI =====
export const PERMISSION_CATEGORIES = {
    capabilities: {
        label: 'Capabilities (Resource:Action)',
        permissions: Object.keys(CAPABILITY_PERMISSIONS)
    },
    scopes: {
        label: 'Access Scopes',
        permissions: Object.keys(SCOPES)
    }
};

// ===== ALL PERMISSIONS (for validation) =====
export const ALL_PERMISSIONS = {
    ...CAPABILITY_PERMISSIONS,
    ...SCOPES
};

// ===== PERMISSION LABELS (combined) =====
export const PERMISSION_LABELS: Record<string, string> = {
    ...CAPABILITY_PERMISSIONS,
    ...SCOPES
};

// ===== HELPER FUNCTIONS =====

/**
 * Check if a user has a specific capability with scope
 * @param permissions - User's permissions array
 * @param capability - The capability to check (e.g., 'tasks:write')
 * @param requiredScope - The minimum scope required ('own', 'team', or 'any')
 * @returns boolean
 */
export function hasCapability(
    permissions: string[],
    capability: string,
    requiredScope: 'own' | 'team' | 'any' = 'own'
): boolean {
    // Check if user has the capability
    if (!permissions.includes(capability)) {
        return false;
    }

    // Check scope
    const scopeHierarchy = { own: 0, team: 1, any: 2 };
    const requiredLevel = scopeHierarchy[requiredScope];

    // Check what scope the user has
    if (permissions.includes('scope:any')) return true;
    if (requiredLevel <= 1 && permissions.includes('scope:team')) return true;
    if (requiredLevel <= 0 && permissions.includes('scope:own')) return true;

    return false;
}

/**
 * Get effective scope for a user
 * @param permissions - User's permissions array
 * @returns 'own' | 'team' | 'any'
 */
export function getEffectiveScope(permissions: string[]): 'own' | 'team' | 'any' {
    if (permissions.includes('scope:any')) return 'any';
    if (permissions.includes('scope:team')) return 'team';
    return 'own';
}
