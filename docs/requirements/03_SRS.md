# System Requirements Specification (SRS)
## Project: Daily Dashboard V2

### 1. Technology Stack

#### Frontend
*   **Framework**: React 18+ (Vite).
*   **Language**: TypeScript (Strict Mode).
*   **State Management**: React Query (Server state), Context API (Auth/Global UI).
*   **Styling**: Tailwind CSS v3.4+, Shadcn/UI (Radix), Lucide Icons.
*   **Real-time**: Socket.io-client.
*   **Analytics**: PostHog.

#### Backend
*   **Runtime**: Node.js v20+.
*   **Framework**: Express.js (ES Modules).
*   **Database**: MongoDB (via Mongoose v8+).
*   **Real-time**: Socket.io Server.
*   **Auth**: JWT (Access 15m, Refresh 7d).

### 2. Data Models (Schemas)

#### 2.1 User
```typescript
interface User {
  _id: ObjectId;
  email: string; // Unique, Lowercase
  passwordHash: string;
  role: 'admin' | 'manager' | 'lead' | 'am' | 'recruiter' | 'expert' | ...;
  teamLead?: string; // Reference to another User (name/email) - recommend changing to ObjectId in V2
  manager?: string; // Reference
  active: boolean;
  profile?: {
    firstName: string;
    lastName: string;
    avatarUrl?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

#### 2.2 Candidate
```typescript
interface Candidate {
  _id: ObjectId;
  'Candidate Name': string;
  'Email ID': string;
  'Contact No': string;
  Branch: string;
  Recruiter: string; // Email/Name reference
  Expert: string; // Email/Name reference
  Technology: string;
  
  // Workflow
  workflowStatus: 'awaiting_expert' | 'needs_resume_understanding' | 'completed';
  resumeUnderstandingStatus: 'pending' | 'done';
  resumeLink?: string;
  
  // Metadata
  source?: any;
  createdBy?: string;
  _last_write: Date;
}
```

#### 2.3 Proposed Schema Improvements (V2)
*   **Refs**: Change string references (`Recruiter`, `Expert`) to `ObjectId` refs to `User` collection for referential integrity.
*   **Naming**: Normalize field names (camelCase instead of `Candidate Name` with spaces).
    *   `Candidate Name` -> `name`
    *   `Email ID` -> `email`
    *   `Contact No` -> `phone`

### 3. API Architecture
*   **RESTful Design**: Resource-based URLs (`/api/v1/candidates`, `/api/v1/users`).
*   **Standard Response**: `{ success: boolean, data: any, error?: string }`.
*   **Error Handling**: Centralized middleware with error codes.

### 4. Deployment & DevOps
*   **Docker**: Multi-stage builds for Frontend and Backend.
*   **CI/CD**: GitHub Actions (Lint, Test, Build).
*   **Environment**: Strict separation of `.env` configs.
