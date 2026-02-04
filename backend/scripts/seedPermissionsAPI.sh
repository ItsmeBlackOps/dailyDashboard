#!/bin/bash
# Seed permissions via API endpoint
# Usage: ./seedPermissionsAPI.sh

API_URL="${API_URL:-http://localhost:5001}"
TOKEN="${ADMIN_TOKEN:-}"

if [ -z "$TOKEN" ]; then
  echo "❌ Error: ADMIN_TOKEN environment variable not set"
  echo "Usage: ADMIN_TOKEN=your_token ./seedPermissionsAPI.sh"
  exit 1
fi

echo "🌱 Seeding permissions via API..."
echo "API URL: $API_URL/api/permissions/seed"

# Seed data
SEED_DATA='{
  "rolePermissions": {
    "admin": ["view_dashboard", "view_tasks", "view_branch_candidates", "view_resume_understanding", "view_admin_alerts", "view_user_management", "view_reports", "view_report_assistant", "view_completed_tab", "update_resume_status_any", "manage_users", "change_password", "view_whats_new", "manage_meetings", "view_meeting_consent_banner", "edit_candidate", "edit_basic_fields", "change_recruiter", "change_contact", "change_expert", "clone_support_task", "send_support_request", "use_received_date_filter", "view_expert_stats", "view_recruiter_stats", "can_see_branch_breakdown", "view_complaints", "create_complaints"],
    "manager": ["view_dashboard", "view_tasks", "view_branch_candidates", "view_resume_understanding", "view_user_management", "view_completed_tab", "manage_users", "change_password", "view_whats_new", "manage_meetings", "edit_candidate", "edit_basic_fields", "create_candidate", "view_create_button", "use_received_date_filter", "view_meeting_consent_banner", "format_notification_as_manager", "view_complaints", "create_complaints"],
    "mm": ["view_dashboard", "view_tasks", "view_branch_candidates", "view_resume_understanding", "view_user_management", "view_reports", "view_report_assistant", "view_completed_tab", "manage_users", "change_password", "view_whats_new", "clone_support_task", "request_mock", "generate_thanks_mail", "delete_tasks", "send_support_request", "edit_candidate", "edit_basic_fields", "change_recruiter", "change_contact", "create_candidate", "view_create_button", "start_driver_tour", "use_received_date_filter"],
    "mam": ["view_dashboard", "view_tasks", "view_branch_candidates", "view_resume_understanding", "view_user_management", "view_reports", "view_report_assistant", "view_completed_tab", "manage_users", "change_password", "view_whats_new", "request_mock", "generate_thanks_mail", "send_support_request", "edit_candidate", "edit_basic_fields", "change_recruiter", "change_contact", "start_driver_tour", "use_received_date_filter"],
    "mlead": ["view_dashboard", "view_tasks", "view_branch_candidates", "view_resume_understanding", "view_user_management", "view_completed_tab", "manage_users", "change_password", "view_whats_new", "clone_support_task", "request_mock", "generate_thanks_mail", "edit_candidate", "edit_basic_fields", "change_recruiter", "change_contact", "start_driver_tour", "use_received_date_filter"],
    "lead": ["view_dashboard", "view_tasks", "view_branch_candidates", "view_resume_understanding", "view_user_management", "view_completed_tab", "manage_users", "change_password", "view_whats_new", "manage_meetings", "view_meeting_consent_banner", "edit_candidate", "change_expert", "view_recruiter_stats", "view_expert_stats", "format_notification_as_lead", "view_complaints"],
    "am": ["view_dashboard", "view_tasks", "view_branch_candidates", "view_resume_understanding", "view_user_management", "view_completed_tab", "manage_users", "change_password", "view_whats_new", "manage_meetings", "clone_support_task", "view_meeting_consent_banner", "edit_candidate", "change_expert"],
    "recruiter": ["view_dashboard", "view_tasks", "view_branch_candidates", "view_resume_understanding", "view_completed_tab", "change_password", "view_whats_new", "manage_meetings", "view_meeting_consent_banner", "clone_support_task", "request_mock", "generate_thanks_mail", "edit_candidate", "edit_basic_fields", "change_contact", "start_driver_tour", "use_received_date_filter"],
    "user": ["view_dashboard", "view_tasks", "view_branch_candidates", "view_resume_understanding", "change_password", "view_whats_new", "manage_meetings", "view_meeting_consent_banner", "filter_resume_events_by_expert", "update_resume_status_own"],
    "expert": ["view_dashboard", "view_tasks", "view_resume_understanding", "change_password", "view_whats_new", "filter_resume_events_by_expert"],
    "mtl": ["view_dashboard", "view_reports", "view_report_assistant"]
  }
}'

# Make API request
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$SEED_DATA" \
  "$API_URL/api/permissions/seed")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Permissions seeded successfully!"
  echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
else
  echo "❌ Failed to seed permissions (HTTP $HTTP_CODE)"
  echo "$BODY"
  exit 1
fi
