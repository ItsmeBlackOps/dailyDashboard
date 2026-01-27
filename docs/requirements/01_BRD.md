# Business Requirements Document (BRD)
## Project: Daily Dashboard V2

### 1. Executive Summary
The goal of **Dashboard V2** is to rebuild the existing "Daily Dashboard" CRM into a scalable, modern, and high-performance application. The system serves as the central hub for tracking candidates, interviews, and recruiter/expert performance. The V2 initiative aims to pay down technical debt, improve UI/UX with a premium "Glassmorphism" design, and enforce strict type safety and architectural best practices.

### 2. Business Goals
*   **Centralized Candidate Tracking**: Unified view of candidates across all branches and recruiters.
*   **Role-Based Efficiency**: distinct workflows for Admins, Managers, Team Leads, Account Managers (AMs), Recruiters, and Experts.
*   **Real-Time Collaboration**: Instant updates on candidate status changes (Resume Understanding, assignments) using Socket.io.
*   **Data-Driven Decisions**: Comprehensive dashboards and reports (KPIs, Conversion rates) for management.

### 3. Stakeholders & User Roles
| Role | Responsibility | Key Features |
| :--- | :--- | :--- |
| **Admin** | System oversight, user management | User Management, Global Alerts, Branch Candidates, All Analytics |
| **Manager/MM** | Strategic oversight | High-level Reports, Team Performance |
| **Lead/MLead** | Team management | Team Tasks, Resume Understanding Review |
| **AM/MAM** | Account Management | Client/Deal tracking, Candidate flow |
| **Recruiter** | Sourcing candidates | Add Candidate, Track Status, View Deals |
| **Expert** | Technical assessment | Resume Understanding, Technical Interviews |

### 4. Scope
#### In Scope
*   **Authentication & Authorization**: Role-based access control (RBAC).
*   **Candidate Management**: CRUD operations, Status workflows (Awaiting Expert -> Needs Resume Understanding -> Completed).
*   **Resume Understanding**: Specialized workflow for Experts to review resumes.
*   **Dashboards**: Role-specific KPI views (Charts, Graphs).
*   **Admin Tools**: User creation, Password management, System alerts.
*   **Real-time Notifications**: Socket.io integration for instant alerts.

#### Out of Scope (for Phase 1)
*   Native Mobile App (Responsive Web App is sufficient).
*   Third-party ATS Integrations (Greenhouse, Lever) - standalone first.

### 5. Success Metrics
*   **System Performance**: Page load times < 1s (P95).
*   **User Adoption**: 100% migration of existing users to V2.
*   **Data Integrity**: Zero schema inconsistencies (enforced by strict validation).
