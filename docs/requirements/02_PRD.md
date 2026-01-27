# Product Requirements Document (PRD)
## Project: Daily Dashboard V2

### 1. User Flows

#### 1.1 Authentication
*   **Sign In**: Email/Password login.
    *   *Validation*: Email format, Password strength.
    *   *Action*: Returns JWT (Access/Refresh). Redirects to `/` (Dashboard).
*   **Sign Up**: (Admin/Invite only usually, but UI exists).
*   **Forgot Password**: Email trigger for reset link.

#### 1.2 Dashboard Strategies (Role-Based)
*   **Admin/Manager**: High-level KPIs (Total Interviews, By Branch, By Technology). "Top Agents" leaderboard.
*   **Recruiter**: Personal pipeline. "My Candidates", "Tasks Today".
*   **Expert**: "Resume Understanding" queue. "Assigned Candidates".

#### 1.3 Resume Understanding Workflow
1.  **Trigger**: Recruiter adds Candidate -> Workflow Status: `Needs Resume Understanding` (if configured) or Admin assigns Expert.
2.  **Action**: Expert receives notification (Socket/Email).
3.  **Process**: Expert views Resume Link, evaluates, logs interaction.
4.  **Completion**: Expert marks "Done". Status updates to `Completed` (or next stage).

### 2. Functional Requirements (Pages)

#### 2.1 Core Pages
| Page | Route | Description | Roles |
| :--- | :--- | :--- | :--- |
| **Dashboard** | `/` | Aggregated stats, charts, quick actions. | All |
| **Tasks** | `/tasks` | Daily to-dos, reminders. | All |
| **Reports** | `/reports` | Detailed tables, exportable data. | Managers, Admins |
| **Branch Ops** | `/branch-candidates` | Master list of all candidates in branch. | Admins, AMs |
| **Alerts** | `/admin-alerts` | System notifications, stuck candidates. | Admin |

#### 2.2 User Management
*   **List Users**: Table with search/filter.
*   **Create User**: Form with Role, Team Lead assignment.
*   **Edit User**: Update role, active status.

### 3. Component Library (Premium Glassmorphism)
The new design system ("Glass") must be implemented globally.
*   **Themes**: Dark Mode default (`#0a0a0a`).
*   **Cards**: `.glass-card` (Backdrop blur, translucent border).
*   **Sidebar**: Collapsible, floating glass panel.
*   **Charts**: Recharts with gradient fills/strokes fitting the dark theme.

### 4. Notifications
*   **Real-time**: Toast notifications for new assignments.
*   **In-App**: Notification bell in Header.
*   **Badges**: Sidebar count badges for "Alerts" and "Resume Understanding".
