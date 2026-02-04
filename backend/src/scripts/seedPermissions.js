// Seed script for initial role permissions
// Run with: node backend/src/scripts/seedPermissions.js

import { rolePermissionModel } from '../models/RolePermission.js';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const INITIAL_ROLE_PERMISSIONS = {
    admin: [
        'view_dashboard', 'view_tasks', 'view_branch_candidates', 'view_resume_understanding',
        'view_admin_alerts', 'view_user_management', 'view_reports', 'view_report_assistant',
        'view_completed_tab', 'update_resume_status_any', 'manage_users', 'change_password',
        'view_whats_new', 'manage_meetings', 'view_meeting_consent_banner', 'edit_candidate',
        'edit_basic_fields', 'change_recruiter', 'change_contact', 'change_expert',
        'clone_support_task', 'send_support_request', 'use_received_date_filter',
        'view_expert_stats', 'view_recruiter_stats', 'can_see_branch_breakdown',
        'view_complaints', 'create_complaints'
    ],
    manager: [
        'view_dashboard', 'view_tasks', 'view_branch_candidates', 'view_resume_understanding',
        'view_user_management', 'view_completed_tab', 'manage_users', 'change_password',
        'view_whats_new', 'manage_meetings', 'edit_candidate', 'edit_basic_fields',
        'create_candidate', 'view_create_button', 'use_received_date_filter',
        'view_meeting_consent_banner', 'format_notification_as_manager',
        'view_complaints', 'create_complaints'
    ],
    mm: [
        'view_dashboard', 'view_tasks', 'view_branch_candidates', 'view_resume_understanding',
        'view_user_management', 'view_reports', 'view_report_assistant', 'view_completed_tab',
        'manage_users', 'change_password', 'view_whats_new', 'clone_support_task',
        'request_mock', 'generate_thanks_mail', 'delete_tasks', 'send_support_request',
        'edit_candidate', 'edit_basic_fields', 'change_recruiter', 'change_contact',
        'create_candidate', 'view_create_button', 'start_driver_tour', 'use_received_date_filter'
    ],
    mam: [
        'view_dashboard', 'view_tasks', 'view_branch_candidates', 'view_resume_understanding',
        'view_user_management', 'view_reports', 'view_report_assistant', 'view_completed_tab',
        'manage_users', 'change_password', 'view_whats_new', 'request_mock',
        'generate_thanks_mail', 'send_support_request', 'edit_candidate', 'edit_basic_fields',
        'change_recruiter', 'change_contact', 'start_driver_tour', 'use_received_date_filter'
    ],
    mlead: [
        'view_dashboard', 'view_tasks', 'view_branch_candidates', 'view_resume_understanding',
        'view_user_management', 'view_completed_tab', 'manage_users', 'change_password',
        'view_whats_new', 'clone_support_task', 'request_mock', 'generate_thanks_mail',
        'edit_candidate', 'edit_basic_fields', 'change_recruiter', 'change_contact',
        'start_driver_tour', 'use_received_date_filter'
    ],
    lead: [
        'view_dashboard', 'view_tasks', 'view_branch_candidates', 'view_resume_understanding',
        'view_user_management', 'view_completed_tab', 'manage_users', 'change_password',
        'view_whats_new', 'manage_meetings', 'view_meeting_consent_banner',
        'edit_candidate', 'change_expert', 'view_recruiter_stats', 'view_expert_stats',
        'format_notification_as_lead', 'view_complaints'
    ],
    am: [
        'view_dashboard', 'view_tasks', 'view_branch_candidates', 'view_resume_understanding',
        'view_user_management', 'view_completed_tab', 'manage_users', 'change_password',
        'view_whats_new', 'manage_meetings', 'clone_support_task', 'view_meeting_consent_banner',
        'edit_candidate', 'change_expert'
    ],
    recruiter: [
        'view_dashboard', 'view_tasks', 'view_branch_candidates', 'view_resume_understanding',
        'view_completed_tab', 'change_password', 'view_whats_new', 'manage_meetings',
        'view_meeting_consent_banner', 'clone_support_task', 'request_mock',
        'generate_thanks_mail', 'edit_candidate', 'edit_basic_fields', 'change_contact',
        'start_driver_tour', 'use_received_date_filter'
    ],
    user: [
        'view_dashboard', 'view_tasks', 'view_branch_candidates', 'view_resume_understanding',
        'change_password', 'view_whats_new', 'manage_meetings', 'view_meeting_consent_banner',
        'filter_resume_events_by_expert', 'update_resume_status_own'
    ],
    expert: [
        'view_dashboard', 'view_tasks', 'view_resume_understanding', 'change_password',
        'view_whats_new', 'filter_resume_events_by_expert'
    ],
    mtl: [
        'view_dashboard', 'view_reports', 'view_report_assistant'
    ]
};

async function seedPermissions() {
    try {
        logger.info('Starting permissions seed...');

        // Initialize database connection
        await database.connect();
        await rolePermissionModel.initialize();

        // Seed permissions
        const result = await rolePermissionModel.seedRolePermissions(
            INITIAL_ROLE_PERMISSIONS,
            'system-seed'
        );

        logger.info('Permissions seeded successfully', {
            modified: result.modifiedCount,
            upserted: result.upsertedCount
        });

        console.log('\n✅ Permissions seeded successfully!');
        console.log(`   Modified: ${result.modifiedCount}`);
        console.log(`   Upserted: ${result.upsertedCount}`);

        // Close connection
        await database.close();
        process.exit(0);
    } catch (error) {
        logger.error('Failed to seed permissions', { error: error.message });
        console.error('\n❌ Failed to seed permissions:', error.message);
        process.exit(1);
    }
}

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
    process.exit(1);
});

// Run seed
seedPermissions();
