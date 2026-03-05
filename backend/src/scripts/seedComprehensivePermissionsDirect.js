import 'dotenv/config';
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'dailyDashboard';

// Comprehensive 150+ permissions seed data
const rolePermissions = {
    admin: [
        'dashboard_view_overview_tab', 'dashboard_view_recruiter_stats_tab', 'dashboard_view_expert_stats_tab', 'dashboard_view_management_reports_tab', 'dashboard_change_date_basis', 'dashboard_change_date_mode', 'dashboard_view_total_candidates_card', 'dashboard_view_total_interviews_card', 'dashboard_view_completed_interviews_card', 'dashboard_view_pending_tasks_card',
        'tasks_view_page', 'tasks_view_subject_column', 'tasks_view_candidate_column', 'tasks_view_expert_column', 'tasks_view_resume_column', 'tasks_view_date_column', 'tasks_view_status_column', 'tasks_view_recruiter_column', 'tasks_view_actions_column',
        'tasks_filter_by_status', 'tasks_filter_by_candidate', 'tasks_filter_by_recruiter', 'tasks_filter_by_expert', 'tasks_filter_by_date_range', 'tasks_filter_by_team_lead',
        'tasks_change_status', 'tasks_assign_expert', 'tasks_view_suggestions', 'tasks_join_meeting', 'tasks_copy_meeting_link', 'tasks_create_meeting', 'tasks_clone_support', 'tasks_request_mock', 'tasks_generate_thanks_mail', 'tasks_generate_interviewer_questions', 'tasks_delete_task', 'tasks_view_transcript', 'tasks_toggle_subject_display', 'tasks_assessment_support',
        'candidates_view_page', 'candidates_view_list', 'candidates_view_name_column', 'candidates_view_email_column', 'candidates_view_contact_column', 'candidates_view_technology_column', 'candidates_view_expert_column', 'candidates_view_recruiter_column', 'candidates_view_status_column', 'candidates_view_interview_date_column', 'candidates_view_actions_column',
        'candidates_create_new', 'candidates_edit_any', 'candidates_edit_name', 'candidates_edit_email', 'candidates_edit_contact', 'candidates_edit_technology', 'candidates_edit_expert', 'candidates_edit_recruiter', 'candidates_edit_status', 'candidates_edit_interview_date', 'candidates_delete',
        'candidates_filter_by_status', 'candidates_filter_by_recruiter', 'candidates_filter_by_expert', 'candidates_filter_by_technology', 'candidates_filter_by_date_range', 'candidates_search', 'candidates_export', 'candidates_import', 'candidates_view_resume', 'candidates_upload_resume', 'candidates_start_tour',
        'resume_view_page', 'resume_view_pending_tab', 'resume_view_inprogress_tab', 'resume_view_completed_tab', 'resume_view_expert_column', 'resume_view_candidate_column', 'resume_view_technology_column', 'resume_view_status_column', 'resume_view_submitted_date_column', 'resume_view_actions_column',
        'resume_view_all_entries', 'resume_update_status_any', 'resume_view_details', 'resume_download', 'resume_add_comments', 'resume_view_comments', 'resume_assign_expert', 'resume_mark_complete', 'resume_reject',
        'resume_filter_by_status', 'resume_filter_by_expert', 'resume_filter_by_technology', 'resume_filter_by_date', 'resume_search',
        'users_view_page', 'users_view_list', 'users_view_name_column', 'users_view_email_column', 'users_view_role_column', 'users_view_team_lead_column', 'users_view_manager_column', 'users_view_status_column', 'users_view_actions_column',
        'users_create_new', 'users_create_admin', 'users_create_manager', 'users_create_mm', 'users_create_mam', 'users_create_mlead', 'users_create_lead', 'users_create_am', 'users_create_recruiter', 'users_create_expert',
        'users_edit_any', 'users_edit_name', 'users_edit_email', 'users_edit_role', 'users_edit_team_lead', 'users_edit_manager', 'users_edit_password', 'users_change_own_password', 'users_activate_deactivate', 'users_delete',
        'users_filter_by_role', 'users_filter_by_status', 'users_filter_by_team_lead', 'users_search', 'users_view_activity_log', 'users_reset_password', 'users_send_welcome_email',
        'reports_view_page', 'reports_view_performance', 'reports_view_activity', 'reports_view_analytics', 'reports_export',
        'alerts_view_page', 'alerts_create', 'alerts_edit', 'alerts_delete',
        'profile_view', 'profile_edit', 'profile_change_password',
        'notifications_view', 'notifications_mark_read', 'notifications_delete', 'notifications_configure',
        'system_view_whats_new', 'system_view_help', 'system_access_settings',
        'meetings_create', 'meetings_edit', 'meetings_delete', 'meetings_join', 'meetings_view_consent_banner'
    ],
    manager: [
        'dashboard_view_overview_tab', 'dashboard_view_recruiter_stats_tab', 'dashboard_change_date_basis', 'dashboard_change_date_mode', 'dashboard_view_total_candidates_card', 'dashboard_view_total_interviews_card', 'dashboard_view_completed_interviews_card', 'dashboard_view_pending_tasks_card',
        'tasks_view_page', 'tasks_view_subject_column', 'tasks_view_candidate_column', 'tasks_view_expert_column', 'tasks_view_date_column', 'tasks_view_status_column', 'tasks_view_recruiter_column', 'tasks_view_actions_column',
        'tasks_filter_by_status', 'tasks_filter_by_candidate', 'tasks_filter_by_recruiter', 'tasks_filter_by_date_range',
        'tasks_change_status', 'tasks_assign_expert', 'tasks_view_suggestions', 'tasks_join_meeting', 'tasks_create_meeting',
        'candidates_view_page', 'candidates_view_list', 'candidates_view_name_column', 'candidates_view_email_column', 'candidates_view_contact_column', 'candidates_view_technology_column', 'candidates_view_recruiter_column', 'candidates_view_status_column', 'candidates_view_actions_column',
        'candidates_create_new', 'candidates_edit_any', 'candidates_edit_name', 'candidates_edit_email', 'candidates_filter_by_status', 'candidates_search',
        'resume_view_page', 'resume_view_pending_tab', 'resume_view_all_entries',
        'users_view_page', 'users_view_list', 'users_create_recruiter', 'users_edit_own', 'users_change_own_password',
        'profile_view', 'profile_edit', 'profile_change_password',
        'notifications_view', 'system_view_whats_new',
        'meetings_create', 'meetings_join', 'meetings_view_consent_banner'
    ],
    mm: [
        'dashboard_view_overview_tab', 'dashboard_view_recruiter_stats_tab', 'dashboard_view_management_reports_tab', 'dashboard_change_date_basis', 'dashboard_change_date_mode', 'dashboard_view_total_candidates_card', 'dashboard_view_total_interviews_card', 'dashboard_view_completed_interviews_card', 'dashboard_view_pending_tasks_card',
        'tasks_view_page', 'tasks_view_subject_column', 'tasks_view_candidate_column', 'tasks_view_expert_column', 'tasks_view_resume_column', 'tasks_view_date_column', 'tasks_view_status_column', 'tasks_view_recruiter_column', 'tasks_view_actions_column',
        'tasks_filter_by_status', 'tasks_filter_by_candidate', 'tasks_filter_by_recruiter', 'tasks_filter_by_expert', 'tasks_filter_by_date_range', 'tasks_filter_by_team_lead',
        'tasks_change_status', 'tasks_assign_expert', 'tasks_clone_support', 'tasks_request_mock', 'tasks_generate_thanks_mail', 'tasks_delete_task',
        'candidates_view_page', 'candidates_view_list', 'candidates_view_name_column', 'candidates_view_email_column', 'candidates_view_contact_column', 'candidates_view_technology_column', 'candidates_view_expert_column', 'candidates_view_recruiter_column', 'candidates_view_status_column', 'candidates_view_actions_column',
        'candidates_create_new', 'candidates_edit_any', 'candidates_edit_name', 'candidates_edit_recruiter', 'candidates_view_resume', 'candidates_upload_resume', 'candidates_filter_by_status', 'candidates_filter_by_recruiter', 'candidates_search', 'candidates_start_tour',
        'resume_view_page', 'resume_view_all_entries', 'resume_update_status_any',
        'users_view_page', 'users_view_list', 'users_create_recruiter', 'users_edit_own', 'users_change_own_password',
        'reports_view_page', 'reports_view_performance',
        'profile_view', 'profile_edit', 'profile_change_password',
        'notifications_view', 'system_view_whats_new',
        'meetings_create', 'meetings_join'
    ],
    mam: [
        'dashboard_view_overview_tab', 'dashboard_view_management_reports_tab',
        'tasks_view_page', 'tasks_view_subject_column', 'tasks_view_candidate_column', 'tasks_view_expert_column', 'tasks_view_date_column', 'tasks_view_status_column', 'tasks_view_actions_column',
        'tasks_filter_by_status', 'tasks_filter_by_candidate', 'tasks_filter_by_expert', 'tasks_filter_by_date_range',
        'tasks_change_status', 'tasks_assign_expert', 'tasks_request_mock', 'tasks_generate_thanks_mail',
        'candidates_view_page', 'candidates_view_list', 'candidates_view_name_column', 'candidates_view_email_column', 'candidates_view_contact_column', 'candidates_view_technology_column', 'candidates_view_expert_column', 'candidates_view_recruiter_column', 'candidates_view_status_column', 'candidates_view_actions_column',
        'candidates_create_new', 'candidates_edit_any', 'candidates_edit_name', 'candidates_edit_email', 'candidates_edit_contact', 'candidates_edit_technology', 'candidates_edit_expert', 'candidates_view_resume', 'candidates_upload_resume', 'candidates_filter_by_status', 'candidates_filter_by_recruiter', 'candidates_filter_by_technology', 'candidates_filter_by_expert', 'candidates_search', 'candidates_start_tour',
        'resume_view_page', 'resume_view_all_entries',
        'users_view_page', 'users_edit_own', 'users_change_own_password',
        'profile_view', 'profile_edit', 'profile_change_password',
        'notifications_view', 'system_view_whats_new',
        'meetings_join'
    ],
    mlead: [
        'dashboard_view_overview_tab', 'dashboard_view_expert_stats_tab',
        'tasks_view_page', 'tasks_view_subject_column', 'tasks_view_candidate_column', 'tasks_view_expert_column', 'tasks_view_date_column', 'tasks_view_status_column', 'tasks_view_actions_column',
        'tasks_filter_by_status', 'tasks_filter_by_expert', 'tasks_filter_by_team_lead',
        'tasks_change_status', 'tasks_assign_expert', 'tasks_clone_support', 'tasks_request_mock',
        'candidates_view_page', 'candidates_view_list', 'candidates_view_name_column', 'candidates_view_email_column', 'candidates_view_contact_column', 'candidates_view_technology_column', 'candidates_view_expert_column', 'candidates_view_recruiter_column', 'candidates_view_status_column', 'candidates_view_actions_column',
        'candidates_edit_any', 'candidates_edit_name', 'candidates_edit_email', 'candidates_edit_contact', 'candidates_edit_technology', 'candidates_edit_expert', 'candidates_view_resume', 'candidates_upload_resume', 'candidates_filter_by_status', 'candidates_filter_by_recruiter', 'candidates_filter_by_technology', 'candidates_filter_by_expert', 'candidates_search', 'candidates_start_tour',
        'resume_view_page', 'resume_view_team_entries', 'resume_assign_expert',
        'users_view_page', 'users_view_list', 'users_edit_own', 'users_change_own_password',
        'profile_view', 'profile_edit', 'profile_change_password',
        'notifications_view', 'system_view_whats_new',
        'meetings_join'
    ],
    lead: [
        'dashboard_view_overview_tab', 'dashboard_view_expert_stats_tab',
        'tasks_view_page', 'tasks_view_subject_column', 'tasks_view_candidate_column', 'tasks_view_expert_column', 'tasks_view_status_column', 'tasks_view_actions_column',
        'tasks_filter_by_status', 'tasks_filter_by_expert',
        'tasks_change_status', 'tasks_assign_expert',
        'candidates_view_page', 'candidates_view_list', 'candidates_view_name_column', 'candidates_view_expert_column',
        'candidates_edit_expert',
        'resume_view_page', 'resume_view_team_entries',
        'users_edit_own', 'users_change_own_password',
        'profile_view', 'profile_edit', 'profile_change_password',
        'notifications_view', 'system_view_whats_new',
        'meetings_create', 'meetings_join', 'meetings_view_consent_banner'
    ],
    am: [
        'dashboard_view_overview_tab',
        'tasks_view_page', 'tasks_view_subject_column', 'tasks_view_candidate_column', 'tasks_view_expert_column', 'tasks_view_status_column',
        'tasks_filter_by_status',
        'tasks_assign_expert', 'tasks_clone_support',
        'candidates_view_page', 'candidates_view_list', 'candidates_view_name_column', 'candidates_view_expert_column',
        'candidates_edit_expert',
        'resume_view_page', 'resume_view_team_entries',
        'users_edit_own', 'users_change_own_password',
        'profile_view', 'profile_edit', 'profile_change_password',
        'notifications_view', 'system_view_whats_new',
        'meetings_create', 'meetings_join', 'meetings_view_consent_banner'
    ],
    recruiter: [
        'dashboard_view_overview_tab', 'dashboard_view_recruiter_stats_tab',
        'tasks_view_page', 'tasks_view_subject_column', 'tasks_view_candidate_column', 'tasks_view_date_column', 'tasks_view_status_column', 'tasks_view_recruiter_column', 'tasks_view_actions_column',
        'tasks_filter_by_status', 'tasks_filter_by_candidate', 'tasks_filter_by_recruiter',
        'tasks_change_status', 'tasks_clone_support', 'tasks_request_mock', 'tasks_generate_thanks_mail',
        'candidates_view_page', 'candidates_view_list', 'candidates_view_name_column', 'candidates_view_email_column', 'candidates_view_contact_column', 'candidates_view_technology_column', 'candidates_view_recruiter_column', 'candidates_view_status_column', 'candidates_view_actions_column',
        'candidates_edit_own', 'candidates_edit_name', 'candidates_edit_contact', 'candidates_view_resume', 'candidates_upload_resume', 'candidates_filter_by_status', 'candidates_search', 'candidates_start_tour',
        'resume_view_page', 'resume_view_pending_tab',
        'users_edit_own', 'users_change_own_password',
        'profile_view', 'profile_edit', 'profile_change_password',
        'notifications_view', 'system_view_whats_new',
        'meetings_create', 'meetings_join', 'meetings_view_consent_banner'
    ],
    user: [
        'dashboard_view_overview_tab',
        'tasks_view_page', 'tasks_view_subject_column', 'tasks_view_candidate_column', 'tasks_view_date_column', 'tasks_view_status_column',
        'tasks_filter_by_status',
        'candidates_view_page', 'candidates_view_list', 'candidates_view_name_column',
        'resume_view_page', 'resume_view_own_entries', 'resume_update_status_own',
        'users_edit_own', 'users_change_own_password',
        'profile_view', 'profile_edit', 'profile_change_password',
        'notifications_view', 'system_view_whats_new',
        'meetings_join', 'meetings_view_consent_banner'
    ],
    expert: [
        'dashboard_view_overview_tab',
        'tasks_view_page', 'tasks_view_subject_column', 'tasks_view_candidate_column', 'tasks_view_date_column',
        'resume_view_page', 'resume_view_own_entries', 'resume_update_status_own',
        'users_edit_own', 'users_change_own_password',
        'profile_view', 'profile_change_password',
        'notifications_view', 'system_view_whats_new'
    ],
    mtl: [
        'dashboard_view_overview_tab', 'dashboard_view_management_reports_tab',
        'reports_view_page', 'reports_view_performance', 'reports_view_activity',
        'profile_view', 'users_change_own_password'
    ]
};

async function seedComprehensivePermissions() {
    const client = new MongoClient(MONGO_URI);

    try {
        console.log('🔌 Connecting to MongoDB...');
        await client.connect();
        console.log('✅ Connected to MongoDB');

        const db = client.db(DB_NAME);
        const collection = db.collection('rolePermissions');

        console.log('🌱 Seeding comprehensive permissions...');

        const operations = [];
        const updatedBy = 'system-seed';
        const updatedAt = new Date();

        for (const [role, permissions] of Object.entries(rolePermissions)) {
            operations.push({
                updateOne: {
                    filter: { role: role.toLowerCase() },
                    update: {
                        $set: {
                            role: role.toLowerCase(),
                            permissions,
                            updatedAt,
                            updatedBy,
                            seeded: true
                        }
                    },
                    upsert: true
                }
            });
        }

        const result = await collection.bulkWrite(operations);

        console.log('✅ Permissions seeded successfully!');
        console.log(`   Modified: ${result.modifiedCount}`);
        console.log(`   Upserted: ${result.upsertedCount}`);
        console.log('');
        console.log('📊 Permission Summary:');
        console.log(`   Total Permissions: 150+`);
        console.log(`   Total Roles: ${Object.keys(rolePermissions).length}`);
        console.log(`   Categories: 14`);
        console.log('');
        console.log('🎉 You can now access /permissions as admin!');

    } catch (error) {
        console.error('❌ Error seeding permissions:', error.message);
        process.exit(1);
    } finally {
        await client.close();
        console.log('👋 MongoDB connection closed');
    }
}

seedComprehensivePermissions();
