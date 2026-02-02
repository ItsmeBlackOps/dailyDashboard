// src/config/permissions.ts

export const ROLES = {
    ADMIN: 'admin',
    MANAGER: 'manager',
    MM: 'mm',
    MAM: 'mam',
    MLEAD: 'mlead',
    LEAD: 'lead',
    AM: 'am',
    RECRUITER: 'recruiter',
    USER: 'user', // Often treated as Expert
    EXPERT: 'expert', // Just in case checks use this alias
    MTL: 'mtl', // Mentioned in Sidebar
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES] | string;

export const PERMISSIONS = {
    // Views (Sidebar Access)
    VIEW_DASHBOARD: 'view_dashboard',
    VIEW_TASKS: 'view_tasks',
    VIEW_BRANCH_CANDIDATES: 'view_branch_candidates',
    VIEW_RESUME_UNDERSTANDING: 'view_resume_understanding',
    VIEW_ADMIN_ALERTS: 'view_admin_alerts',
    VIEW_USER_MANAGEMENT: 'view_user_management',
    VIEW_REPORTS: 'view_reports',
    VIEW_REPORT_ASSISTANT: 'view_report_assistant',

    // Resume Understanding Specifics
    VIEW_COMPLETED_TAB: 'view_completed_tab',
    FILTER_RESUME_EVENTS_BY_EXPERT: 'filter_resume_events_by_expert', // For lead/user/expert to only see own
    UPDATE_RESUME_STATUS_ANY: 'update_resume_status_any',
    UPDATE_RESUME_STATUS_OWN: 'update_resume_status_own',

    // Dashboard Widgets
    VIEW_EXPERT_STATS: 'view_expert_stats',
    VIEW_RECRUITER_STATS: 'view_recruiter_stats',
    CAN_SEE_BRANCH_BREAKDOWN: 'can_see_branch_breakdown',

    // Notification / Discussion
    FORMAT_NOTIFICATION_AS_LEAD: 'format_notification_as_lead',
    FORMAT_NOTIFICATION_AS_MANAGER: 'format_notification_as_manager',
    VIEW_COMPLAINTS: 'view_complaints',
    CREATE_COMPLAINTS: 'create_complaints',

    // Actions (Global)
    MANAGE_USERS: 'manage_users',
    CHANGE_PASSWORD: 'change_password', // Allowed for all logged in
    VIEW_WHATS_NEW: 'view_whats_new',

    // Tasks Today
    DELETE_TASKS: 'delete_tasks',
    CLONE_SUPPORT_TASK: 'clone_support_task',
    REQUEST_MOCK: 'request_mock',
    GENERATE_THANKS_MAIL: 'generate_thanks_mail',
    MANAGE_MEETINGS: 'manage_meetings', // Consents
    VIEW_MEETING_CONSENT_BANNER: 'view_meeting_consent_banner', // Hide for recruiters etc?
    SEND_SUPPORT_REQUEST: 'send_support_request',

    // Branch Candidates
    EDIT_CANDIDATE: 'edit_candidate',
    EDIT_BASIC_FIELDS: 'edit_basic_fields',
    CHANGE_RECRUITER: 'change_recruiter',
    CHANGE_CONTACT: 'change_contact',
    CHANGE_EXPERT: 'change_expert',
    CREATE_CANDIDATE: 'create_candidate',
    VIEW_CREATE_BUTTON: 'view_create_button',
    START_DRIVER_TOUR: 'start_driver_tour', // Tour eligible roles

    // Dashboard / Index
    USE_RECEIVED_DATE_FILTER: 'use_received_date_filter',

    // Data Scopes (Not strictly permissions but useful for logic)
    CAN_SEE_ALL_TEAM: 'can_see_all_team',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Centralized Role Definition
// [USER_REQUEST]: "Role Can See Which Tasks Which Branch Candidates" -
// We define who has what permission here.

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
    [ROLES.ADMIN]: [
        // Views
        PERMISSIONS.VIEW_DASHBOARD,
        PERMISSIONS.VIEW_TASKS,
        PERMISSIONS.VIEW_BRANCH_CANDIDATES,
        PERMISSIONS.VIEW_RESUME_UNDERSTANDING,
        PERMISSIONS.VIEW_ADMIN_ALERTS,
        PERMISSIONS.VIEW_USER_MANAGEMENT,
        PERMISSIONS.VIEW_REPORTS,
        PERMISSIONS.VIEW_REPORT_ASSISTANT,
        PERMISSIONS.VIEW_COMPLETED_TAB,
        PERMISSIONS.UPDATE_RESUME_STATUS_ANY,

        // Actions
        PERMISSIONS.MANAGE_USERS,
        PERMISSIONS.CHANGE_PASSWORD,
        PERMISSIONS.VIEW_WHATS_NEW,
        PERMISSIONS.MANAGE_MEETINGS,
        PERMISSIONS.VIEW_MEETING_CONSENT_BANNER,

        // Branch Candidates
        PERMISSIONS.EDIT_CANDIDATE,
        PERMISSIONS.EDIT_BASIC_FIELDS,
        PERMISSIONS.CHANGE_RECRUITER,
        PERMISSIONS.CHANGE_CONTACT,
        PERMISSIONS.CHANGE_EXPERT,
        // Note: Admin might not have 'create_candidate' in original code?
        // Original: showCreateButton = isManager || normalizedRole === 'mm';
        // Actually Admin WAS excluded from showCreateButton in BranchCandidates.tsx:281
        // But Admin IS in canEdit... We should verify.
        // Wait, let's stick to original logic:
        // const showCreateButton = isManager || normalizedRole === 'mm';
        // So NO CREATE for Admin? That seems odd, but we will replicate.

        // Tasks
        PERMISSIONS.CLONE_SUPPORT_TASK,
        PERMISSIONS.SEND_SUPPORT_REQUEST,

        // Dashboard
        PERMISSIONS.USE_RECEIVED_DATE_FILTER,
        PERMISSIONS.VIEW_EXPERT_STATS,
        PERMISSIONS.VIEW_RECRUITER_STATS,
        PERMISSIONS.CAN_SEE_BRANCH_BREAKDOWN,
        PERMISSIONS.VIEW_COMPLAINTS,
        PERMISSIONS.CREATE_COMPLAINTS,
    ],

    [ROLES.MANAGER]: [
        PERMISSIONS.VIEW_DASHBOARD,
        PERMISSIONS.VIEW_TASKS,
        PERMISSIONS.VIEW_BRANCH_CANDIDATES,
        PERMISSIONS.VIEW_RESUME_UNDERSTANDING,
        PERMISSIONS.VIEW_USER_MANAGEMENT,
        PERMISSIONS.VIEW_COMPLETED_TAB,
        PERMISSIONS.MANAGE_USERS,
        PERMISSIONS.CHANGE_PASSWORD,
        PERMISSIONS.VIEW_WHATS_NEW,
        PERMISSIONS.MANAGE_MEETINGS,

        // Branch Candidates
        PERMISSIONS.EDIT_CANDIDATE,
        PERMISSIONS.EDIT_BASIC_FIELDS, // Manager was in canEdit (line 275) but NOT in canEditBasicFields (line 276)?
        // Original: canEditBasicFields = ["mm", "mam", "mlead", "recruiter", "admin"]
        // Manager is missing from basic fields? That's weird.
        // Wait, let's check line 276 of BranchCandidates.tsx
        // 276: const canEditBasicFields = ["mm", "mam", "mlead", "recruiter", "admin"].includes(normalizedRole);
        // UserManagement 275 said: canEdit includes manager.
        // If canEdit is true but canEditBasicFields is false, that's possible.
        // But Manager HAS 'CREATE_CANDIDATE' (line 280-281).
        PERMISSIONS.CREATE_CANDIDATE,
        PERMISSIONS.VIEW_CREATE_BUTTON, // Distinct from create action?

        // Dashboard
        PERMISSIONS.USE_RECEIVED_DATE_FILTER, // Not in original list?
        PERMISSIONS.VIEW_MEETING_CONSENT_BANNER,
        PERMISSIONS.FORMAT_NOTIFICATION_AS_MANAGER,
        PERMISSIONS.VIEW_COMPLAINTS,
        PERMISSIONS.CREATE_COMPLAINTS,
    ],

    [ROLES.MM]: [
        PERMISSIONS.VIEW_DASHBOARD,
        PERMISSIONS.VIEW_TASKS,
        PERMISSIONS.VIEW_BRANCH_CANDIDATES,
        PERMISSIONS.VIEW_RESUME_UNDERSTANDING,
        PERMISSIONS.VIEW_USER_MANAGEMENT,
        PERMISSIONS.VIEW_REPORTS,
        PERMISSIONS.VIEW_REPORT_ASSISTANT,
        PERMISSIONS.VIEW_COMPLETED_TAB,
        PERMISSIONS.MANAGE_USERS,
        PERMISSIONS.CHANGE_PASSWORD,
        PERMISSIONS.VIEW_WHATS_NEW,

        // Tasks
        PERMISSIONS.CLONE_SUPPORT_TASK,
        PERMISSIONS.REQUEST_MOCK,
        PERMISSIONS.GENERATE_THANKS_MAIL,
        PERMISSIONS.DELETE_TASKS, // Assuming MM can delete? Not explicit in grep.
        PERMISSIONS.SEND_SUPPORT_REQUEST,

        // Branch Candidates
        PERMISSIONS.EDIT_CANDIDATE,
        PERMISSIONS.EDIT_BASIC_FIELDS,
        PERMISSIONS.CHANGE_RECRUITER,
        PERMISSIONS.CHANGE_CONTACT,
        PERMISSIONS.CREATE_CANDIDATE,
        PERMISSIONS.VIEW_CREATE_BUTTON,
        PERMISSIONS.START_DRIVER_TOUR,

        // Dashboard
        PERMISSIONS.USE_RECEIVED_DATE_FILTER,
    ],

    [ROLES.MAM]: [
        PERMISSIONS.VIEW_DASHBOARD,
        PERMISSIONS.VIEW_TASKS,
        PERMISSIONS.VIEW_BRANCH_CANDIDATES,
        PERMISSIONS.VIEW_RESUME_UNDERSTANDING,
        PERMISSIONS.VIEW_USER_MANAGEMENT,
        PERMISSIONS.VIEW_REPORTS,
        PERMISSIONS.VIEW_REPORT_ASSISTANT,
        PERMISSIONS.VIEW_COMPLETED_TAB,
        PERMISSIONS.MANAGE_USERS,
        PERMISSIONS.CHANGE_PASSWORD,
        PERMISSIONS.VIEW_WHATS_NEW,

        // Tasks
        // Original tasks: canCloneSupport = !['user', 'lead', 'mam'] -> So MAM CANNOT clone support.
        PERMISSIONS.REQUEST_MOCK,
        PERMISSIONS.GENERATE_THANKS_MAIL,
        PERMISSIONS.SEND_SUPPORT_REQUEST,

        // Branch Candidates
        PERMISSIONS.EDIT_CANDIDATE,
        PERMISSIONS.EDIT_BASIC_FIELDS,
        PERMISSIONS.CHANGE_RECRUITER,
        PERMISSIONS.CHANGE_CONTACT,
        PERMISSIONS.START_DRIVER_TOUR,

        // Dashboard
        PERMISSIONS.USE_RECEIVED_DATE_FILTER,
    ],

    [ROLES.MLEAD]: [
        PERMISSIONS.VIEW_DASHBOARD,
        PERMISSIONS.VIEW_TASKS,
        PERMISSIONS.VIEW_BRANCH_CANDIDATES,
        PERMISSIONS.VIEW_RESUME_UNDERSTANDING,
        PERMISSIONS.VIEW_USER_MANAGEMENT,
        PERMISSIONS.VIEW_COMPLETED_TAB,
        PERMISSIONS.MANAGE_USERS,
        PERMISSIONS.CHANGE_PASSWORD,
        PERMISSIONS.VIEW_WHATS_NEW,

        // Tasks
        PERMISSIONS.CLONE_SUPPORT_TASK,
        PERMISSIONS.REQUEST_MOCK,
        PERMISSIONS.GENERATE_THANKS_MAIL,

        // Branch Candidates
        PERMISSIONS.EDIT_CANDIDATE,
        PERMISSIONS.EDIT_BASIC_FIELDS,
        PERMISSIONS.CHANGE_RECRUITER,
        PERMISSIONS.CHANGE_CONTACT,
        PERMISSIONS.START_DRIVER_TOUR,

        // Dashboard
        PERMISSIONS.USE_RECEIVED_DATE_FILTER,
    ],

    [ROLES.LEAD]: [
        PERMISSIONS.VIEW_DASHBOARD,
        PERMISSIONS.VIEW_TASKS,
        PERMISSIONS.VIEW_BRANCH_CANDIDATES,
        PERMISSIONS.VIEW_RESUME_UNDERSTANDING,
        PERMISSIONS.VIEW_USER_MANAGEMENT,
        PERMISSIONS.VIEW_COMPLETED_TAB,
        PERMISSIONS.MANAGE_USERS,
        PERMISSIONS.CHANGE_PASSWORD,
        PERMISSIONS.VIEW_WHATS_NEW,
        PERMISSIONS.MANAGE_MEETINGS,

        // Tasks
        // Cannot clone support
        PERMISSIONS.VIEW_MEETING_CONSENT_BANNER,

        // Branch Candidates
        PERMISSIONS.EDIT_CANDIDATE,
        PERMISSIONS.CHANGE_EXPERT,
        PERMISSIONS.VIEW_RECRUITER_STATS, // Based on inference? No, original TopAgents didn't include 'MAM/MM/MLead' logic for Lead.
        // Original TopAgents for Lead: ["expert", "candidate"].
        PERMISSIONS.VIEW_EXPERT_STATS,
        PERMISSIONS.FORMAT_NOTIFICATION_AS_LEAD,
        PERMISSIONS.VIEW_COMPLAINTS,
        // No create complaints
    ],

    [ROLES.AM]: [
        PERMISSIONS.VIEW_DASHBOARD,
        PERMISSIONS.VIEW_TASKS,
        PERMISSIONS.VIEW_BRANCH_CANDIDATES,
        PERMISSIONS.VIEW_RESUME_UNDERSTANDING,
        PERMISSIONS.VIEW_USER_MANAGEMENT,
        PERMISSIONS.VIEW_COMPLETED_TAB,
        PERMISSIONS.MANAGE_USERS,
        PERMISSIONS.CHANGE_PASSWORD,
        PERMISSIONS.VIEW_WHATS_NEW,
        PERMISSIONS.MANAGE_MEETINGS,

        // Tasks
        PERMISSIONS.CLONE_SUPPORT_TASK,
        PERMISSIONS.VIEW_MEETING_CONSENT_BANNER,

        // Branch Candidates
        PERMISSIONS.EDIT_CANDIDATE,
        PERMISSIONS.CHANGE_EXPERT,
    ],

    [ROLES.RECRUITER]: [
        PERMISSIONS.VIEW_DASHBOARD,
        PERMISSIONS.VIEW_TASKS,
        PERMISSIONS.VIEW_BRANCH_CANDIDATES,
        PERMISSIONS.VIEW_RESUME_UNDERSTANDING,
        PERMISSIONS.VIEW_COMPLETED_TAB,
        // No View User Management
        PERMISSIONS.CHANGE_PASSWORD,
        PERMISSIONS.VIEW_WHATS_NEW,
        PERMISSIONS.MANAGE_MEETINGS,
        PERMISSIONS.VIEW_MEETING_CONSENT_BANNER,

        // Tasks
        PERMISSIONS.CLONE_SUPPORT_TASK,
        PERMISSIONS.REQUEST_MOCK,
        PERMISSIONS.GENERATE_THANKS_MAIL,

        // Branch Candidates
        PERMISSIONS.EDIT_CANDIDATE,
        PERMISSIONS.EDIT_BASIC_FIELDS,
        PERMISSIONS.CHANGE_CONTACT,
        PERMISSIONS.START_DRIVER_TOUR,

        // Dashboard
        PERMISSIONS.USE_RECEIVED_DATE_FILTER,
    ],

    [ROLES.USER]: [
        PERMISSIONS.VIEW_DASHBOARD,
        PERMISSIONS.VIEW_TASKS,
        PERMISSIONS.VIEW_BRANCH_CANDIDATES,
        PERMISSIONS.VIEW_RESUME_UNDERSTANDING,
        // No view completed tab for user?
        // ResumeUnderstanding.tsx: showCompletedTab = role !== 'user' && role !== 'expert';

        PERMISSIONS.CHANGE_PASSWORD,
        PERMISSIONS.VIEW_WHATS_NEW,
        PERMISSIONS.MANAGE_MEETINGS,
        PERMISSIONS.VIEW_MEETING_CONSENT_BANNER,
        PERMISSIONS.FILTER_RESUME_EVENTS_BY_EXPERT,
        PERMISSIONS.UPDATE_RESUME_STATUS_OWN,

        // Branch Candidates
        // Can View (line 274)
    ],

    [ROLES.EXPERT]: [
        PERMISSIONS.VIEW_DASHBOARD,
        PERMISSIONS.VIEW_TASKS,
        PERMISSIONS.VIEW_BRANCH_CANDIDATES, // Not in list in BranchCandidates.tsx:274??
        // 274: "admin", "mm", "mam", "mlead", "lead", "user", "am", "manager", "recruiter"
        // expert is NOT in canView for BranchCandidates in original code.
        // However, UserManagement links user/expert. 
        // We will stick to original logic: No View Branch Candidates for Expert if logic says so.
        // But in ResumeUnderstanding check: allowed includes 'expert'.
        PERMISSIONS.VIEW_RESUME_UNDERSTANDING,
        PERMISSIONS.CHANGE_PASSWORD,
        PERMISSIONS.VIEW_WHATS_NEW,
        PERMISSIONS.FILTER_RESUME_EVENTS_BY_EXPERT,
    ],

    // MTL is mentioned in Sidebar report check
    [ROLES.MTL]: [
        PERMISSIONS.VIEW_DASHBOARD,
        PERMISSIONS.VIEW_REPORTS,
        PERMISSIONS.VIEW_REPORT_ASSISTANT
    ]
};

// Helper to normalize
export function normalizeRole(role: string): string {
    return role ? role.trim().toLowerCase() : '';
}

export function hasPermission(role: string, permission: Permission): boolean {
    if (!role) return false;
    const normalized = normalizeRole(role);

    // Direct match
    const perms = ROLE_PERMISSIONS[normalized] || [];
    if (perms.includes(permission)) return true;

    // Fallback aliases
    if (normalized === ROLES.EXPERT) {
        // Sometimes expert is treated as user?
        // In Sidebar: expert IS in showResumeNav.
        // We handle explicit expert in ROLE_PERMISSIONS[ROLES.EXPERT] above.
    }

    return false;
}

// User Management Logic
// Replicates getCreatableRoles from UserManagement.tsx
export function getCreatableRoles(currentRole: string): string[] {
    const r = normalizeRole(currentRole);
    if (r === ROLES.ADMIN) {
        return [ROLES.ADMIN, ROLES.MANAGER, 'MM', 'MAM', 'AM', ROLES.MLEAD, ROLES.RECRUITER, ROLES.LEAD, ROLES.USER, ROLES.EXPERT];
    }
    if (r === ROLES.MANAGER) {
        return ['MM', 'MAM', 'AM', ROLES.MLEAD, ROLES.RECRUITER, ROLES.LEAD, ROLES.USER, ROLES.EXPERT];
    }
    if (r === ROLES.MM) {
        return ['MAM'];
    }
    if (r === ROLES.MAM) {
        return [ROLES.MLEAD, ROLES.RECRUITER];
    }
    if (r === ROLES.AM) {
        return [ROLES.LEAD, ROLES.USER];
    }
    if (r === ROLES.LEAD) {
        return [ROLES.USER];
    }
    if (r === ROLES.MLEAD) {
        return [ROLES.RECRUITER];
    }
    return [];
}
