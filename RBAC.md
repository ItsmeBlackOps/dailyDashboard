## Role: Admin

### Description
- This role is used for full system control.
- This role shares most management access with the Manager role, but it can also delete users and see all candidates.

### Permissions this role has
- Manage all users, including list, search, user statistics, create, update, change roles, change team leads, reset passwords, and delete users.
- Create and update many users at one time, and view the list of users it can manage.
- View all tasks, task statistics, and dashboard summaries, and open any task by identifier.
- Use the receivedDateTime field in task search and dashboard filters.
- View, create, and update any candidate, including expert assignment and resume understanding status.
- View pending expert assignments and resume understanding queues.
- Upload resumes.
- Use the report bot feature over sockets.

### Permissions this role does not have
- Create interview support requests.
- Create assessment support requests.
- Create mock interview support requests.
- Generate thank you email content.
- Extract interviewer questions.

### Accessible APIs / Pages
- Basic signed in endpoints: /api/tasks, /api/tasks/search, /api/tasks/statistics, /api/tasks/dashboard-summary, /api/tasks/:taskId, /api/users/team, /api/users/profile/:email (any email), /api/users/profile/:email/password (any email), /api/auth/profile, /api/profile/me.
- User management endpoints: /api/users, /api/users/role/:role, /api/users/stats, /api/users/manageable, /api/users/search, /api/users/bulk, /api/users/:email/role, /api/users/:email/team-lead, /api/users/:email (DELETE).
- Authentication endpoints for user creation and statistics: /api/auth/users, /api/auth/stats.
- Resume upload: /api/candidates/resume.
- Task socket events: getTasksToday, getDashboardSummary, getTasksByRange, getTaskById, searchTasks, getTaskStatistics.
- Candidate socket events: getBranchCandidates, updateBranchCandidate, createCandidate, assignCandidateExpert, updateResumeUnderstanding, getPendingExpertAssignments, getPendingExpertAssignmentsCount, getResumeUnderstandingQueue, getResumeUnderstandingCount.
- Report bot socket events: reportBotQuery, reportBotDownload.

### Not accessible APIs / Pages
- /api/support/interview
- /api/support/assessment
- /api/support/mock
- /api/tasks/:taskId/thanks-mail
- /api/tasks/:taskId/interviewer-questions

### Accessible Frontend Pages
- Dashboard page (/).
- Tasks page (/tasks).
- Branch Candidates page (/branch-candidates) with edit access.
- Admin Alerts page (/admin-alerts).
- User Management page (/user-management).
- Report Assistant page (/reports/assistant).

### Not accessible Frontend Pages
- Reports page (/reports).
- Resume Understanding page (/resume-understanding).

### MongoDB access
- users collection (read and write: email, role, teamLead, manager, active, profile).
- refreshTokens collection (write: revoke tokens on password change or delete).
- taskBody collection (read all tasks; fields include assignedTo, assignedExpert, sender, cc, Date of Interview, receivedDateTime, status).
- candidateDetails collection (read and write all candidate fields, including Branch, Recruiter, Expert, Technology, Candidate Name, Email ID, Contact No, resumeLink, workflowStatus, resumeUnderstandingStatus, createdBy).
- transcripts collection (read to build task transcription status).

## Role: Manager

### Description
- This role is used for people who manage teams and candidates.
- This role shares most management access with the Admin role, but it cannot delete users.

### Permissions this role has
- Manage users like Admin, except for delete.
- Create and update many users at one time, and view the list of users it can manage.
- Create candidates and assign experts.
- View pending expert assignments and resume understanding queues.
- Upload resumes.
- View tasks assigned to them, task statistics, and dashboard summaries for their scope.

### Permissions this role does not have
- Delete users.
- View full candidate lists through branch or hierarchy views. getBranchCandidates returns an empty list.
- Update candidate details after creation, except expert assignment.
- Use the report bot feature.
- Create support requests.
- Generate thank you email content or interviewer questions.
- Use the receivedDateTime field in task filters.

### Accessible APIs / Pages
- Basic signed in endpoints: /api/tasks, /api/tasks/search, /api/tasks/statistics, /api/tasks/dashboard-summary, /api/tasks/:taskId, /api/users/team, /api/users/profile/:email (any email), /api/users/profile/:email/password (any email), /api/auth/profile, /api/profile/me.
- User management endpoints: /api/users, /api/users/role/:role, /api/users/stats, /api/users/manageable, /api/users/search, /api/users/bulk, /api/users/:email/role, /api/users/:email/team-lead.
- Authentication endpoints for user creation and statistics: /api/auth/users, /api/auth/stats.
- Resume upload: /api/candidates/resume.
- Task socket events: getTasksToday, getDashboardSummary, getTasksByRange, getTaskById, searchTasks, getTaskStatistics.
- Candidate socket events: getBranchCandidates (returns empty list), createCandidate, assignCandidateExpert, getPendingExpertAssignments, getPendingExpertAssignmentsCount, getResumeUnderstandingQueue, getResumeUnderstandingCount.

### Not accessible APIs / Pages
- /api/users/:email (DELETE)
- /api/support/interview
- /api/support/assessment
- /api/support/mock
- /api/tasks/:taskId/thanks-mail
- /api/tasks/:taskId/interviewer-questions
- Report bot socket events: reportBotQuery, reportBotDownload
- Candidate socket events: updateBranchCandidate

### Accessible Frontend Pages
- Dashboard page (/).
- Tasks page (/tasks).
- Branch Candidates page (/branch-candidates) with view access and create button.
- User Management page (/user-management).

### Not accessible Frontend Pages
- Reports page (/reports).
- Report Assistant page (/reports/assistant).
- Admin Alerts page (/admin-alerts).
- Resume Understanding page (/resume-understanding).

### MongoDB access
- users collection (read and write: email, role, teamLead, manager, active, profile).
- refreshTokens collection (write: revoke tokens on password change or delete).
- taskBody collection (read assigned tasks; fields include assignedTo, sender, cc, Date of Interview, status).
- candidateDetails collection (read for pending assignment and resume understanding queues; write for candidate creation and expert assignment).
- transcripts collection (read to build task transcription status).

## Role: MM

### Description
- This role is used for branch level management.
- This role shares support request and transcript features with the Recruiter, mlead, and MAM roles.
- This role shares report bot access with Admin, MAM, and MTL.

### Permissions this role has
- View tasks where sender or cc matches their email name.
- Search tasks and dashboard summaries using the receivedDateTime field.
- View candidates in the mapped branch.
- Update candidate fields except expert.
- Create candidates with resume link, branch, recruiter, and candidate details.
- Send interview support, assessment support, and mock support requests.
- Generate thank you email content and interviewer questions.
- Create and update many users at one time, limited to creating MAM and managing MAM, mlead, and recruiter roles.
- View the list of users it can manage.
- Upload resumes.
- Use the report bot feature over sockets.

### Permissions this role does not have
- List all users or view user statistics.
- Delete users or change roles outside the allowed set.
- Assign experts to candidates.
- View pending expert assignments or resume understanding queues.
- Update resume understanding unless they are the assigned expert.

### Accessible APIs / Pages
- Basic signed in endpoints: /api/tasks, /api/tasks/search, /api/tasks/statistics, /api/tasks/dashboard-summary, /api/tasks/:taskId, /api/users/team, /api/users/profile/:email (self), /api/users/profile/:email/password (self), /api/auth/profile, /api/profile/me.
- User tools endpoints: /api/users/manageable, /api/users/bulk.
- Support request endpoints: /api/support/interview, /api/support/assessment, /api/support/mock.
- Transcript tools: /api/tasks/:taskId/thanks-mail, /api/tasks/:taskId/interviewer-questions.
- Resume upload: /api/candidates/resume.
- Task socket events: getTasksToday, getDashboardSummary, getTasksByRange, getTaskById, searchTasks, getTaskStatistics.
- Candidate socket events: getBranchCandidates, updateBranchCandidate, createCandidate.
- Report bot socket events: reportBotQuery, reportBotDownload.

### Not accessible APIs / Pages
- /api/users
- /api/users/stats
- /api/users/:email/role
- /api/users/:email/team-lead
- /api/users/:email (DELETE)
- Candidate socket events: assignCandidateExpert, getPendingExpertAssignments, getPendingExpertAssignmentsCount, getResumeUnderstandingQueue, getResumeUnderstandingCount

### Accessible Frontend Pages
- Dashboard page (/).
- Tasks page (/tasks).
- Branch Candidates page (/branch-candidates) with edit access and create button.
- Reports page (/reports).
- Report Assistant page (/reports/assistant).
- User Management page (/user-management).

### Not accessible Frontend Pages
- Admin Alerts page (/admin-alerts).
- Resume Understanding page (/resume-understanding).

### MongoDB access
- users collection (read for team lists and user creation rules).
- taskBody collection (read filtered by sender and cc; fields include sender, cc, assignedTo, Date of Interview, receivedDateTime, status).
- candidateDetails collection (read and write within the mapped branch, except Expert field).
- transcripts collection (read for thank you email, interviewer questions, and task transcription status).

## Role: MAM

### Description
- This role is used for a manager over recruiter teams.
- This role shares support request and transcript features with the Recruiter, mlead, and MM roles.
- This role shares report bot access with Admin, MM, and MTL.

### Permissions this role has
- View tasks where sender or cc matches the manager name stored on the user record.
- Search tasks and dashboard summaries using the receivedDateTime field.
- View candidates for recruiters in their team hierarchy.
- Update candidate fields except expert.
- Send interview support, assessment support, and mock support requests.
- Generate thank you email content and interviewer questions.
- Create and update many users at one time, limited to creating mlead and recruiter roles.
- View the list of users it can manage.
- Use the report bot feature over sockets.

### Permissions this role does not have
- List all users or view user statistics.
- Delete users or change roles outside mlead and recruiter.
- Create candidates or assign experts.
- Upload resumes.
- View pending expert assignments or resume understanding queues.
- Update resume understanding unless they are the assigned expert.

### Accessible APIs / Pages
- Basic signed in endpoints: /api/tasks, /api/tasks/search, /api/tasks/statistics, /api/tasks/dashboard-summary, /api/tasks/:taskId, /api/users/team, /api/users/profile/:email (self), /api/users/profile/:email/password (self), /api/auth/profile, /api/profile/me.
- User tools endpoints: /api/users/manageable, /api/users/bulk.
- Support request endpoints: /api/support/interview, /api/support/assessment, /api/support/mock.
- Transcript tools: /api/tasks/:taskId/thanks-mail, /api/tasks/:taskId/interviewer-questions.
- Task socket events: getTasksToday, getDashboardSummary, getTasksByRange, getTaskById, searchTasks, getTaskStatistics.
- Candidate socket events: getBranchCandidates, updateBranchCandidate.
- Report bot socket events: reportBotQuery, reportBotDownload.

### Not accessible APIs / Pages
- /api/users
- /api/users/stats
- /api/users/:email/role
- /api/users/:email/team-lead
- /api/users/:email (DELETE)
- /api/candidates/resume
- Candidate socket events: createCandidate, assignCandidateExpert, getPendingExpertAssignments, getPendingExpertAssignmentsCount, getResumeUnderstandingQueue, getResumeUnderstandingCount

### Accessible Frontend Pages
- Dashboard page (/).
- Tasks page (/tasks).
- Branch Candidates page (/branch-candidates) with edit access.
- Reports page (/reports).
- Report Assistant page (/reports/assistant).
- User Management page (/user-management).

### Not accessible Frontend Pages
- Admin Alerts page (/admin-alerts).
- Resume Understanding page (/resume-understanding).

### MongoDB access
- users collection (read for hierarchy and user creation rules).
- taskBody collection (read filtered by sender and cc; fields include sender, cc, assignedTo, Date of Interview, receivedDateTime, status).
- candidateDetails collection (read and write for recruiter hierarchy, except Expert field).
- transcripts collection (read for thank you email, interviewer questions, and task transcription status).

## Role: mlead

### Description
- This role is used for a lead over recruiters.
- This role shares support request and transcript features with the Recruiter, MAM, and MM roles.
- This role shares user creation rules with MAM and MM, but only for recruiter roles.

### Permissions this role has
- View tasks where sender or cc matches their email.
- Search tasks and dashboard summaries using the receivedDateTime field.
- View candidates for recruiters in their team hierarchy.
- Update candidate fields except expert.
- Send interview support, assessment support, and mock support requests.
- Generate thank you email content and interviewer questions.
- Create and update many users at one time, limited to creating and managing recruiter roles.
- View the list of users it can manage.

### Permissions this role does not have
- List all users or view user statistics.
- Delete users or change roles outside recruiter.
- Create candidates or assign experts.
- Upload resumes.
- Use the report bot feature.
- View pending expert assignments or resume understanding queues.

### Accessible APIs / Pages
- Basic signed in endpoints: /api/tasks, /api/tasks/search, /api/tasks/statistics, /api/tasks/dashboard-summary, /api/tasks/:taskId, /api/users/team, /api/users/profile/:email (self), /api/users/profile/:email/password (self), /api/auth/profile, /api/profile/me.
- User tools endpoints: /api/users/manageable, /api/users/bulk.
- Support request endpoints: /api/support/interview, /api/support/assessment, /api/support/mock.
- Transcript tools: /api/tasks/:taskId/thanks-mail, /api/tasks/:taskId/interviewer-questions.
- Task socket events: getTasksToday, getDashboardSummary, getTasksByRange, getTaskById, searchTasks, getTaskStatistics.
- Candidate socket events: getBranchCandidates, updateBranchCandidate.

### Not accessible APIs / Pages
- /api/users
- /api/users/stats
- /api/users/:email/role
- /api/users/:email/team-lead
- /api/users/:email (DELETE)
- /api/candidates/resume
- Report bot socket events: reportBotQuery, reportBotDownload
- Candidate socket events: createCandidate, assignCandidateExpert, getPendingExpertAssignments, getPendingExpertAssignmentsCount, getResumeUnderstandingQueue, getResumeUnderstandingCount

### Accessible Frontend Pages
- Dashboard page (/).
- Tasks page (/tasks).
- Branch Candidates page (/branch-candidates) with edit access.
- User Management page (/user-management).

### Not accessible Frontend Pages
- Reports page (/reports).
- Report Assistant page (/reports/assistant).
- Admin Alerts page (/admin-alerts).
- Resume Understanding page (/resume-understanding).

### MongoDB access
- users collection (read for hierarchy and user creation rules).
- taskBody collection (read filtered by sender and cc; fields include sender, cc, assignedTo, Date of Interview, receivedDateTime, status).
- candidateDetails collection (read and write for recruiter hierarchy, except Expert field).
- transcripts collection (read for thank you email, interviewer questions, and task transcription status).

## Role: Recruiter

### Description
- This role is used for recruiters who handle their own candidates and tasks.
- This role shares support request and transcript features with mlead, MAM, and MM.

### Permissions this role has
- View tasks where sender, cc, to, or assignment matches their email or name.
- Search tasks and dashboard summaries using the receivedDateTime field.
- View candidates where they are listed as recruiter.
- Update candidate name, email, contact number, and technology only.
- Send interview support, assessment support, and mock support requests.
- Generate thank you email content and interviewer questions.

### Permissions this role does not have
- User management or user creation and update.
- Create candidates or assign experts.
- Update candidate branch, recruiter, expert, resume link, workflow status, or resume understanding status.
- Upload resumes.
- Use the report bot feature.
- View pending expert assignments or resume understanding queues.

### Accessible APIs / Pages
- Basic signed in endpoints: /api/tasks, /api/tasks/search, /api/tasks/statistics, /api/tasks/dashboard-summary, /api/tasks/:taskId, /api/users/team, /api/users/profile/:email (self), /api/users/profile/:email/password (self), /api/auth/profile, /api/profile/me.
- Support request endpoints: /api/support/interview, /api/support/assessment, /api/support/mock.
- Transcript tools: /api/tasks/:taskId/thanks-mail, /api/tasks/:taskId/interviewer-questions.
- Task socket events: getTasksToday, getDashboardSummary, getTasksByRange, getTaskById, searchTasks, getTaskStatistics.
- Candidate socket events: getBranchCandidates, updateBranchCandidate.

### Not accessible APIs / Pages
- /api/users
- /api/users/stats
- /api/users/manageable
- /api/users/search
- /api/users/bulk
- /api/users/role/:role
- /api/candidates/resume
- Report bot socket events: reportBotQuery, reportBotDownload
- Candidate socket events: createCandidate, assignCandidateExpert, getPendingExpertAssignments, getPendingExpertAssignmentsCount, getResumeUnderstandingQueue, getResumeUnderstandingCount

### Accessible Frontend Pages
- Dashboard page (/).
- Tasks page (/tasks).
- Branch Candidates page (/branch-candidates) with edit access.

### Not accessible Frontend Pages
- Reports page (/reports).
- Report Assistant page (/reports/assistant).
- Admin Alerts page (/admin-alerts).
- Resume Understanding page (/resume-understanding).
- User Management page (/user-management).

### MongoDB access
- users collection (read for hierarchy and support checks).
- taskBody collection (read filtered by sender, cc, to, assignedTo, and assignedExpert).
- candidateDetails collection (read for recruiter matched candidates; write limited to Candidate Name, Email ID, Contact No, Technology).
- transcripts collection (read for thank you email, interviewer questions, and task transcription status).

## Role: AM

### Description
- This role is used for a manager over lead and user experts.
- This role shares team based task and candidate access with the Lead role.

### Permissions this role has
- View tasks for their team, including unassigned tasks when the candidate expert matches the team.
- View candidates where expert is in their team or is themselves.
- Update candidate expert field only.
- Create and update many users at one time for Lead and User roles, and manage those roles.
- View users by role for Lead, User, and Expert, and search users.
- View the list of users it can manage.
- View resume understanding queue and count for their team, and update resume understanding when assigned as expert.

### Permissions this role does not have
- Full user management, delete users, or manage other role types.
- Create candidates or assign experts through admin only paths.
- Update candidate fields other than expert.
- Send support requests or generate thank you email content or interviewer questions.
- Upload resumes.
- Use the report bot feature.
- View pending expert assignments.
- Use the receivedDateTime field in task filters.

### Accessible APIs / Pages
- Basic signed in endpoints: /api/tasks, /api/tasks/search, /api/tasks/statistics, /api/tasks/dashboard-summary, /api/tasks/:taskId, /api/users/team, /api/users/profile/:email (self), /api/users/profile/:email/password (self), /api/auth/profile, /api/profile/me.
- User tools endpoints: /api/users/manageable, /api/users/bulk, /api/users/search, /api/users/role/:role.
- Task socket events: getTasksToday, getDashboardSummary, getTasksByRange, getTaskById, searchTasks, getTaskStatistics.
- Candidate socket events: getBranchCandidates, updateBranchCandidate, updateResumeUnderstanding, getResumeUnderstandingQueue, getResumeUnderstandingCount.

### Not accessible APIs / Pages
- /api/users
- /api/users/stats
- /api/users/:email/role
- /api/users/:email/team-lead
- /api/users/:email (DELETE)
- /api/support/interview
- /api/support/assessment
- /api/support/mock
- /api/tasks/:taskId/thanks-mail
- /api/tasks/:taskId/interviewer-questions
- /api/candidates/resume
- Report bot socket events: reportBotQuery, reportBotDownload
- Candidate socket events: createCandidate, assignCandidateExpert, getPendingExpertAssignments, getPendingExpertAssignmentsCount

### Accessible Frontend Pages
- Dashboard page (/).
- Tasks page (/tasks).
- Branch Candidates page (/branch-candidates) with edit access.
- Resume Understanding page (/resume-understanding).
- User Management page (/user-management).

### Not accessible Frontend Pages
- Reports page (/reports).
- Report Assistant page (/reports/assistant).
- Admin Alerts page (/admin-alerts).

### MongoDB access
- users collection (read for team lists and user creation rules).
- taskBody collection (read filtered by team, suggestions, and assignment).
- candidateDetails collection (read for team experts; write limited to Expert field).
- transcripts collection (read for task transcription status).
- candidateDetails resumeUnderstandingStatus and workflowStatus (read for resume understanding queue).

## Role: Lead

### Description
- This role is used for a lead over users.
- This role shares team based task and candidate access with the AM role.

### Permissions this role has
- View tasks for their team, including unassigned tasks when the candidate expert matches the team.
- View candidates where expert is in their team or is themselves.
- Update candidate expert field only.
- Create and update many users at one time for User role, and manage User role.
- View users by role for User and Expert, and search users.
- View the list of users it can manage.
- View resume understanding queue and count for their team, and update resume understanding when assigned as expert.

### Permissions this role does not have
- Full user management, delete users, or manage other role types.
- Create candidates or assign experts through admin only paths.
- Update candidate fields other than expert.
- Send support requests or generate thank you email content or interviewer questions.
- Upload resumes.
- Use the report bot feature.
- View pending expert assignments.
- Use the receivedDateTime field in task filters.

### Accessible APIs / Pages
- Basic signed in endpoints: /api/tasks, /api/tasks/search, /api/tasks/statistics, /api/tasks/dashboard-summary, /api/tasks/:taskId, /api/users/team, /api/users/profile/:email (self), /api/users/profile/:email/password (self), /api/auth/profile, /api/profile/me.
- User tools endpoints: /api/users/manageable, /api/users/bulk, /api/users/search, /api/users/role/:role.
- Task socket events: getTasksToday, getDashboardSummary, getTasksByRange, getTaskById, searchTasks, getTaskStatistics.
- Candidate socket events: getBranchCandidates, updateBranchCandidate, updateResumeUnderstanding, getResumeUnderstandingQueue, getResumeUnderstandingCount.

### Not accessible APIs / Pages
- /api/users
- /api/users/stats
- /api/users/:email/role
- /api/users/:email/team-lead
- /api/users/:email (DELETE)
- /api/support/interview
- /api/support/assessment
- /api/support/mock
- /api/tasks/:taskId/thanks-mail
- /api/tasks/:taskId/interviewer-questions
- /api/candidates/resume
- Report bot socket events: reportBotQuery, reportBotDownload
- Candidate socket events: createCandidate, assignCandidateExpert, getPendingExpertAssignments, getPendingExpertAssignmentsCount

### Accessible Frontend Pages
- Dashboard page (/).
- Tasks page (/tasks).
- Branch Candidates page (/branch-candidates) with edit access.
- Resume Understanding page (/resume-understanding).
- User Management page (/user-management).

### Not accessible Frontend Pages
- Reports page (/reports).
- Report Assistant page (/reports/assistant).
- Admin Alerts page (/admin-alerts).

### MongoDB access
- users collection (read for team lists and user creation rules).
- taskBody collection (read filtered by team, suggestions, and assignment).
- candidateDetails collection (read for team experts; write limited to Expert field).
- transcripts collection (read for task transcription status).
- candidateDetails resumeUnderstandingStatus and workflowStatus (read for resume understanding queue).

## Role: User

### Description
- This role is used for individual experts who are not managers.
- This role shares task and resume understanding access with the Expert role.

### Permissions this role has
- View tasks assigned to them and unassigned tasks when the candidate expert matches their email.
- View candidates where expert is their email.
- View resume understanding queue and count for their own tasks, and update resume understanding when assigned as expert.
- Update their own user profile and password.

### Permissions this role does not have
- User management or user creation and update.
- Update candidate details or create candidates.
- Assign experts.
- Send support requests or generate thank you email content or interviewer questions.
- Upload resumes.
- Use the report bot feature.
- View pending expert assignments.
- Use the receivedDateTime field in task filters.

### Accessible APIs / Pages
- Basic signed in endpoints: /api/tasks, /api/tasks/search, /api/tasks/statistics, /api/tasks/dashboard-summary, /api/tasks/:taskId, /api/users/team, /api/users/profile/:email (self), /api/users/profile/:email/password (self), /api/auth/profile, /api/profile/me.
- Task socket events: getTasksToday, getDashboardSummary, getTasksByRange, getTaskById, searchTasks, getTaskStatistics.
- Candidate socket events: getBranchCandidates, updateResumeUnderstanding, getResumeUnderstandingQueue, getResumeUnderstandingCount.

### Not accessible APIs / Pages
- /api/users
- /api/users/stats
- /api/users/manageable
- /api/users/search
- /api/users/bulk
- /api/users/role/:role
- /api/support/interview
- /api/support/assessment
- /api/support/mock
- /api/tasks/:taskId/thanks-mail
- /api/tasks/:taskId/interviewer-questions
- /api/candidates/resume
- Report bot socket events: reportBotQuery, reportBotDownload
- Candidate socket events: updateBranchCandidate, createCandidate, assignCandidateExpert, getPendingExpertAssignments, getPendingExpertAssignmentsCount

### Accessible Frontend Pages
- Dashboard page (/).
- Tasks page (/tasks).
- Branch Candidates page (/branch-candidates) with view only.
- Resume Understanding page (/resume-understanding).

### Not accessible Frontend Pages
- Reports page (/reports).
- Report Assistant page (/reports/assistant).
- Admin Alerts page (/admin-alerts).
- User Management page (/user-management).

### MongoDB access
- users collection (read own profile and role).
- taskBody collection (read filtered by assignment and candidate expert match).
- candidateDetails collection (read for own expert records and task suggestions).
- transcripts collection (read for task transcription status).
- candidateDetails resumeUnderstandingStatus and workflowStatus (read for resume understanding queue).

## Role: Expert

### Description
- This role is used for experts who only work on their own tasks.
- This role shares task and resume understanding access with the User role.

### Permissions this role has
- View tasks assigned to them and unassigned tasks when the candidate expert matches their email.
- View resume understanding queue and count for their own tasks, and update resume understanding when assigned as expert.
- Update their own user profile and password.

### Permissions this role does not have
- Candidate list access through getBranchCandidates.
- Update candidate details or create candidates.
- User management or user creation and update.
- Assign experts.
- Send support requests or generate thank you email content or interviewer questions.
- Upload resumes.
- Use the report bot feature.
- View pending expert assignments.
- Use the receivedDateTime field in task filters.

### Accessible APIs / Pages
- Basic signed in endpoints: /api/tasks, /api/tasks/search, /api/tasks/statistics, /api/tasks/dashboard-summary, /api/tasks/:taskId, /api/users/team, /api/users/profile/:email (self), /api/users/profile/:email/password (self), /api/auth/profile, /api/profile/me.
- Task socket events: getTasksToday, getDashboardSummary, getTasksByRange, getTaskById, searchTasks, getTaskStatistics.
- Candidate socket events: updateResumeUnderstanding, getResumeUnderstandingQueue, getResumeUnderstandingCount.

### Not accessible APIs / Pages
- /api/users
- /api/users/stats
- /api/users/manageable
- /api/users/search
- /api/users/bulk
- /api/users/role/:role
- /api/support/interview
- /api/support/assessment
- /api/support/mock
- /api/tasks/:taskId/thanks-mail
- /api/tasks/:taskId/interviewer-questions
- /api/candidates/resume
- Report bot socket events: reportBotQuery, reportBotDownload
- Candidate socket events: getBranchCandidates, updateBranchCandidate, createCandidate, assignCandidateExpert, getPendingExpertAssignments, getPendingExpertAssignmentsCount

### Accessible Frontend Pages
- Dashboard page (/).
- Tasks page (/tasks).
- Resume Understanding page (/resume-understanding).

### Not accessible Frontend Pages
- Branch Candidates page (/branch-candidates).
- Reports page (/reports).
- Report Assistant page (/reports/assistant).
- Admin Alerts page (/admin-alerts).
- User Management page (/user-management).

### MongoDB access
- users collection (read own profile and role).
- taskBody collection (read filtered by assignment and candidate expert match).
- candidateDetails collection (read for task suggestions and resume understanding queue).
- transcripts collection (read for task transcription status).
- candidateDetails resumeUnderstandingStatus and workflowStatus (read for resume understanding queue).

## Role: MTL

### Description
- This role is used for report bot access only.
- This role shares report bot access with Admin, MM, and MAM.

### Permissions this role has
- Use the report bot socket events to generate and download reports.
- View tasks assigned to them like a basic user.
- Update their own user profile and password.

### Permissions this role does not have
- User management or user creation and update.
- Candidate list access, candidate updates, or candidate creation.
- Send support requests or generate thank you email content or interviewer questions.
- Upload resumes.
- View pending expert assignments or resume understanding queues.
- Use the receivedDateTime field in task filters.

### Accessible APIs / Pages
- Basic signed in endpoints: /api/tasks, /api/tasks/search, /api/tasks/statistics, /api/tasks/dashboard-summary, /api/tasks/:taskId, /api/users/team, /api/users/profile/:email (self), /api/users/profile/:email/password (self), /api/auth/profile, /api/profile/me.
- Task socket events: getTasksToday, getDashboardSummary, getTasksByRange, getTaskById, searchTasks, getTaskStatistics.
- Report bot socket events: reportBotQuery, reportBotDownload.

### Not accessible APIs / Pages
- /api/users
- /api/users/stats
- /api/users/manageable
- /api/users/search
- /api/users/bulk
- /api/users/role/:role
- /api/support/interview
- /api/support/assessment
- /api/support/mock
- /api/tasks/:taskId/thanks-mail
- /api/tasks/:taskId/interviewer-questions
- /api/candidates/resume
- Candidate socket events: getBranchCandidates, updateBranchCandidate, createCandidate, assignCandidateExpert, getPendingExpertAssignments, getPendingExpertAssignmentsCount, getResumeUnderstandingQueue, getResumeUnderstandingCount

### Accessible Frontend Pages
- Dashboard page (/).
- Tasks page (/tasks).
- Report Assistant page (/reports/assistant).

### Not accessible Frontend Pages
- Reports page (/reports).
- Branch Candidates page (/branch-candidates).
- Admin Alerts page (/admin-alerts).
- Resume Understanding page (/resume-understanding).
- User Management page (/user-management).

### MongoDB access
- users collection (read own profile and role).
- taskBody collection (read assigned tasks).
- candidateDetails collection (read for task suggestions).
- transcripts collection (read for task transcription status).
