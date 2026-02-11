User Acceptance Testing (UAT) Plan
Overview
This plan covers verification of recent features:

Persistent Discussion Notifications: Tracking unread comments in Resume Understanding.
Resume Understanding Workflow: Deep linking and drawer synchronization.
Mock Support: Requesting mock interviews with attachments.
Backend Proxy: Verifying application functionality without absolute API URLs.
Pre-requisites
Login as a user with 
recruiter
, mlead, mam, or 
mm
 role.
Ensure Nginx container is rebuilt or restarted to apply proxy changes.
1. Backend Proxy & Infrastructure
1.1 Application Loading
 URL: Open http://localhost:8180 (or your deployed URL).
 Verify the application loads without errors in the console regarding connection refusals or CORS.
 Network Tab: Confirm API requests (e.g., /api/auth/me, /api/candidates) are successful and go to the same origin (e.g., http://localhost:8180/api/...).
1.2 Real-time Connection
 Verify Socket.IO connection is established (check Network -> WS or console for "Socket connected").
 Reload the page and ensure persistent connection.
2. Mock Support Feature
2.1 Access Control
 Navigate to Dashboard.
 Select a candidate to open the sheet.
 Verify "Request Mock" button exists in the "Actions" section.
 Negative Test: Log in as a generic user (if applicable) and verify button is hidden (or verify purely based on your known role permissions).
2.2 Form Interaction & Validation
 Click "Request Mock".
 Verify the dialog opens with Candidate Name, Email, Contact, and Technology pre-filled.
 Click "Request Mock" without filling "End Client" or "Date/Time".
 Verify error message: "End client is required" or "Interview date and time is required".
2.3 Successful Submission
 Fill End Client (e.g., "UAT Client").
 Select a Mock Round (e.g., "Mock 1").
 Select a Future Date and Time.
 Optional: Attach a PDF Resume.
 Click "Complete Request".
 Verify:
Success toast appears.
Dialog closes.
(Backend) Verify Recruiter/Lead receives an email notification.
3. Persistent Discussion Notifications
3.1 Unread Indicator (Sender Side)
 Setup: Have User A (e.g., Recruiter) leave a comment on Candidate X's Resume Understanding discussion.
 Verification (User B - e.g., Manager):
Log in as User B.
Navigate to Resume Understanding.
Verify the Message Icon for Candidate X has a Red Dot.
Verify the Sidebar "Resume Understanding" link has a numeric badge (if there are unread items).
3.2 Read Logic
 Click the Message Icon for Candidate X.
 Verify the Red Dot disappears immediately.
 Close the drawer.
 Refresh the page.
 Verify the Red Dot remains gone (persistence check).
3.3 Real-time Updates
 Keep User B's browser open on Resume Understanding.
 User A posts another comment.
 Verify User B sees the Red Dot appear in real-time without refreshing.
4. Resume Understanding Workflow
4.1 Deep Linking
 Manually append ?discussionCandidateId=<VALID_CANDIDATE_ID> to the URL.
 Press Enter.
 Verify the page loads and automatically opens the Discussion Drawer for that candidate.
4.2 URL Synchronization
 Open a Discussion Drawer normally.
 Verify the URL updates to include ?discussionCandidateId=....
 Close the Drawer.
 Verify the URL parameter is removed.

