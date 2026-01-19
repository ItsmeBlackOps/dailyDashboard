# Daily Dashboard

## Getting Started

1. Copy the sample environment file and update secrets:
   ```bash
   cp .env.example .env
   ```
2. Follow the backend and frontend setup sections below to install dependencies and run the apps.

## Backend

### Setup

1. Install dependencies:
   ```bash
   cd backend && npm install
   ```
2. Create a `.env` file in `backend` with:
   ```ini
   MONGODB_URI=<your mongo uri>
   PORT=3000
   JWT_SECRET=<random secret>
   # Allowed origin for CORS
   FRONTEND_ORIGIN=http://localhost:5173
   # New Relic instrumentation (optional locally)
   NEW_RELIC_LICENSE_KEY=<your license key>
   NEW_RELIC_APP_NAME=dailydb-backend
   NEW_RELIC_LOG_LEVEL=info
   NEW_RELIC_NO_CONFIG_FILE=true
   ```
3. Start the server:
   ```bash
   npm start
   ```

### Tech Stack
- Node.js (ESM)
- Express
- Mongoose
- moment-timezone
- Jest
- Supertest

### Environment Variables
- `MONGODB_URI` – MongoDB connection string.
- `PORT` – Port for the HTTP server (default `3000`).
- `JWT_SECRET` – Secret for signing JWT tokens.
- `FRONTEND_ORIGIN` – Allowed origin for CORS requests (default `http://localhost:5173`).
- `OPENAI_API_KEY` – (Required for report assistant) API key used to call OpenAI's chat completion endpoint.
- `OPENAI_BASE_URL` – Optional base URL for OpenAI-compatible providers (default `https://api.openai.com/v1`).
- `OPENAI_REPORTING_MODEL` – Chat model identifier used by the report assistant (default `gpt-5`).
- `OPENAI_TIMEOUT_MS` – Request timeout in milliseconds for OpenAI calls (default `20000`).
- `NEW_RELIC_LICENSE_KEY` – New Relic account license key (required in staging/production).
- `NEW_RELIC_APP_NAME` / `NEW_RELIC_BACKEND_APP_NAME` – Service name reported to New Relic (default `dailydb-backend`).
- `NEW_RELIC_LOG_LEVEL` – Log verbosity for the agent (default `info`).
- `NEW_RELIC_NO_CONFIG_FILE` – Set to `true` to rely on environment configuration only.
- `LOGFLARE_SOURCE_ID` – Logflare source UUID used for debug telemetry.
- `LOGFLARE_API_KEY` – API key granting access to the Logflare source.
- `LOGFLARE_ENDPOINT` – Override for the Logflare ingestion endpoint (default `https://api.logflare.app/logs`).
- `AZURE_TENANT_ID` – Entra tenant ID used for Microsoft Graph auth (default `common`).
- `AZURE_CLIENT_ID` – Confidential client (backend app registration) Application (client) ID.
- `AZURE_CLIENT_SECRET` – Secret generated for the backend app registration.
- `BACKEND_REDIRECT_URI` – Redirect URI registered for the backend consent flow (default `http://localhost:4000/auth/redirect`).
- `AZURE_GRAPH_MEETING_SCOPES` – Optional comma-separated Graph scopes (default `https://graph.microsoft.com/OnlineMeetings.ReadWrite`).
- `AZURE_GRAPH_MAIL_SCOPES` – Optional comma-separated scopes for mail sending (default `https://graph.microsoft.com/Mail.Send`).
- `AZURE_GRAPH_MAIL_SENDER` – User principal name or ID the application will impersonate when application-level Graph mail is required (optional).
- `SUPPORT_REQUEST_TO` – Primary recipient for interview support notifications (defaults to `tech.leaders@silverspaceinc.com`).
- `SUPPORT_REQUEST_CC` – Optional comma-separated CC recipients automatically added to every support email.
- `SUPPORT_ATTACHMENT_MAX_BYTES` – Maximum allowed PDF attachment size in bytes (defaults to `5242880`, i.e. 5 MB).

### AI Report Assistant
- Available over WebSocket events `reportBotQuery` and `reportBotDownload`.
- Restricted to users with roles `admin`, `MM`, or `mtl` (case-insensitive).
- Given a natural-language request, the assistant generates a MongoDB filter against the `taskBody` collection and returns a preview plus a download token.
- The frontend exposes the assistant at `/reports/assistant` with a chat interface, preview table, and Excel download button.

### Interviewer Question Extraction
- `POST /api/tasks/:taskId/interviewer-questions` extracts interviewer-only questions from the stored transcript (TxAv) using the configured OpenAI chat model (defaults to gpt-4.1).
- Available to `recruiter`, `mlead`, `mam`, and `mm` roles. Access is rate-limited to three requests every six hours per user.
- The endpoint sanitizes responses, normalizes question metadata, and returns a cached timestamp plus remaining quota indicators.
- Shares the `OPENAI_*` configuration used by the thank-you email generator; ensure those environment variables are set before enabling the feature.

### Dev Scripts
- `npm start` – runs the server
- `npm test` – runs Jest unit tests

### Realtime Notifications
- Candidate lifecycle actions (`create`, `update`, `assign expert`, `resume status`) publish domain events onto an in-process bus. The notification orchestrator fans those events into the `notification_outbox` MongoDB collection with audience tags (`branch:XYZ`, `recruiter:user@example.com`, etc.) and a checksum for deduplication.
- A background delivery worker polls the outbox, claims pending rows, and emits `notifications:new` payloads to any sockets that subscribed to the matching scope via `candidateNotifications:subscribe`. Subscriptions are tracked server-side per socket—no browser storage is required—and they are cleaned up automatically on disconnect.
- Delivery receipts (including skip reasons) live alongside the outbox document and are purged via a TTL index on `expiresAt`, keeping the collection lean without manual cron jobs.
- Frontend consumers can react to `notifications:new` to refresh data or raise in-app toasts. The Branch Candidates screen now auto-subscribes to the active scope, shows a live notification panel, and throttles refresh requests to avoid spam.
- To exercise the end-to-end flow locally, run `npm test` inside `backend/` to execute the new notification unit tests and then trigger a candidate update—every connected client on the same branch (or hierarchy/expert scope) receives a single, deduped alert.

### Interview Support Requests
- Roles `recruiter`, `mlead`, `mam`, and `mm` can open the **Support** dialog from Branch Candidates to email tech leadership.
- The backend exposes `POST /api/support/interview` (multipart form) to validate the payload, enforce role-based access, and deliver the formatted email via Microsoft Graph with optional resume and job description PDFs.
- Configure the Graph mail environment variables (`AZURE_GRAPH_MAIL_SCOPES`, `SUPPORT_REQUEST_*`, and optionally `AZURE_GRAPH_MAIL_SENDER`) so the backend can deliver the formatted email through Microsoft Graph. Attachments are limited to PDFs under the configured size cap.
- A success response returns `{ success: true, message: 'Support request sent successfully' }`; validation errors surface 400 responses that the frontend surfaces inline.

### Microsoft Graph Mail
- `POST /api/graph/mail/send` forwards a Graph-compatible payload (see sample below) to `me/sendMail` using the caller’s delegated token.
- Interview support requests also flow through Microsoft Graph using the logged-in user's delegated token (the frontend includes `x-graph-access-token` with a `Mail.Send` access token), ensuring recipients see the actual requester.
- The frontend helper `sendGraphMail` in `frontend/src/utils/graphMail.ts` acquires a token via MSAL and posts the payload to the backend. Ensure MSAL login scopes include `https://graph.microsoft.com/Mail.Send` and `https://graph.microsoft.com/Mail.Read` (both are part of the default build).
- Example payload:
  ```json
  {
    "message": {
      "subject": "Hello from Graph",
      "body": { "contentType": "HTML", "content": "<p>Hi there 👋</p>" },
      "toRecipients": [{ "emailAddress": { "address": "someone@example.com" } }],
      "ccRecipients": [{ "emailAddress": { "address": "cc@example.com" } }],
      "attachments": [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          "name": "notes.txt",
          "contentBytes": "SGVsbG8gZ3JhcGgh"
        }
      ]
    },
    "saveToSentItems": true
  }
  ```

### Testing
- Ensure a MongoDB instance is available and export `MONGODB_URI`, `DB_NAME`, `JWT_SECRET`, `TEST_USER_EMAIL`, and `TEST_USER_PASSWORD` before executing `npm test`.
- Populate deterministic fixtures for integration tests with `node scripts/seed-test-data.mjs` (runs against the URI in the active environment).
- The test harness depends on Socket.IO; keep the database credentials scoped to non-production data sources when running tests locally or in CI.

### Authentication
Use `POST /login` with `email` and `password` to obtain an access token and a refresh token. Send the access token in the `Authorization: Bearer` header for protected endpoints. The `/tasks/today` route and other future APIs require a valid token.

Tokens may also be refreshed over WebSocket by emitting a `refresh` event with a valid refresh token. The server responds with a new access token which the frontend stores automatically.

To log what you are currently working on, send a `POST /tasks/today` request with `email`, `role`, `teamLead`, `manager` and `activity` in the body. The endpoint stores the sanitized activity in memory and returns a confirmation message.

API documentation is provided using Swagger. A minimal OpenAPI 3.1 document is served at `GET /api/docs/openapi.json` and includes the shared `Task` schema used by socket responses.

### TasksToday Enhancements

- Suggestions column shows who a task can be assigned to based on the candidate’s Expert from `candidateDetails`.
- If no suggestion is available, the column shows `Not available` (entries are never filtered out due to missing suggestions).
- Subject column is hidden by default. Users can toggle visibility via the “Show Subject” switch; the choice is persisted per-browser.
- When Azure AD configuration is present, each task row exposes a “Create meeting” button that provisions an online Teams meeting based on the subject and scheduled time. First-time users see a consent banner that launches the Microsoft permissions dialog and polls the backend health check until consent succeeds. Once a meeting is created the join links are saved back onto the task, replacing the action with “Join meeting” and “Copy link” shortcuts.
- Recruiters and leads can open the Actions menu and choose **Extract Interviewer Questions** (below **Generate Thanks Mail**) to fetch a sanitized, categorized list of interviewer questions. Extracted lists are cached locally per task and respect the same 3-per-6-hour GPT usage limit surfaced in the dialog.

### Microsoft Teams Meetings (prototype)

- Backend exposes new Microsoft Graph helpers:
  - `GET /auth/consent` & `GET /auth/redirect` start and complete the delegated consent flow for `OnlineMeetings.ReadWrite`.
  - `GET /api/graph/health/meetings` performs an On-Behalf-Of token exchange to confirm consent.
  - `POST /api/graph/meetings` creates an online meeting using the request subject and optional ISO8601 start/end timestamps.
- Configure the Azure app registration via the environment variables listed above. Missing credentials disable the endpoints gracefully (`503 not_configured`).
- Consent and meeting helpers rely on Microsoft’s `@azure/msal-node` (backend) and `@azure/msal-browser`/`@azure/msal-react` (frontend) packages pinned to their latest stable releases.

New fields on each task payload:

- `candidateExpertDisplay: string | null` — display name derived from `candidateDetails.Expert`.
- `suggestions: string[]` — suggested assignees (currently seeded from candidate expert).

## Frontend

The frontend is a small React application powered by Vite. After logging in it fetches tasks from the backend and displays them.

### Setup
```bash
cd frontend && npm install
npm run dev
```

Open `http://localhost:3000` to view the login page.

The frontend leverages the reusable components under `frontend/components/ui`.
The login screen and the table used to display tasks are built exclusively using
these UI primitives. After signing in you will be redirected to `/dashboard`

where today's tasks appear in a table. Expired access tokens are automatically
refreshed via a Socket.IO `refresh` event using the stored refresh token. If a
socket connection fails with `Unauthorized`, the client transparently requests a
new token, reconnects, and reloads tasks.

Tasks update in real time using a MongoDB change stream. The frontend listens
to `taskCreated` and `taskUpdated` events from the WebSocket. To guard against
any missed messages it also polls the backend every minute. New tasks trigger a
short beep and a browser notification. The view also shows interview reminders:
thirty-five minutes before a scheduled interview a notification bar appears and
the browser plays the beep so the alert is heard even if the tab is in the
background.

### Tech Stack
- React
- TypeScript
- Vite

### Dev Scripts
- `npm run dev` – start the Vite dev server
- `npm run build` – build production assets
- `npm run lint` – run ESLint
- `npm run start` – serve the built bundle with the New Relic agent
- `npm test` – run unit tests (vitest + RTL)

### Environment Variables
- `API_URL` – Backend base URL.
- `FRONTEND_PORT` – Port the preview server listens on (default `8180`).
- `NEW_RELIC_LICENSE_KEY` – New Relic account license key (required in staging/production).
- `NEW_RELIC_APP_NAME` / `NEW_RELIC_FRONTEND_APP_NAME` – Service name reported to New Relic (default `dailydb-frontend`).
- `NEW_RELIC_LOG_LEVEL` – Log verbosity for the agent (default `info`).
- `NEW_RELIC_NO_CONFIG_FILE` – Set to `true` to rely on environment configuration only.
- `FRONTEND_HOST` – Host binding for the preview server (default `0.0.0.0`).
- `FRONTEND_OPEN` – Whether to auto-open a browser window (default `false`).
- `VITE_API_BASE` – REST base URL for consent and meeting endpoints (defaults to `VITE_API_URL`).
- `VITE_API_SCOPE` – Delegated scope for the backend application (e.g. `api://<backend-app-id>/user_impersonation`).
- `VITE_LOGIN_SCOPES` – Space-delimited login scopes requested via MSAL (default `User.Read https://graph.microsoft.com/OnlineMeetings.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite`).
- `VITE_AZURE_CLIENT_ID` – SPA application (client) ID used by MSAL.
- `VITE_AZURE_TENANT_ID` – Azure tenant ID (default `common`).
- `VITE_AZURE_AUTHORITY` – Optional authority override; defaults to `https://login.microsoftonline.com/<tenant>`.
- `VITE_AZURE_REDIRECT_URI` – Frontend redirect URI registered for the SPA (defaults to `window.location.origin`).

## Continuous Integration

Automated workflows live in `.github/workflows/ci.yml`. The pipeline installs dependencies with Node.js 22, seeds MongoDB with test fixtures, and executes the backend and frontend test suites on every push and pull request.

## Docker Compose

Run both services together with New Relic instrumentation:

```bash
docker compose up --build
```

The stack consumes values from `.env` (or `.env.example` as a starting point) and forwards the New Relic environment variables into each container.

## Dashboard Charts

- Overall Interviews uses an interactive bar chart; Top Performing Agents uses a fully stacked, interactive bar chart — both with a glassmorphism style (Recharts latest stable).
- Top Performing Agents adds:
  - Display modes: All, Top 10, Top 10 + Others (aggregated)
  - Hover-only legend: tooltip is sorted by value; a compact color legend overlay appears on chart hover showing the hovered stack’s color mapping.
- Components changed:
  - `frontend/src/components/dashboard/KpiOverview.tsx: OverallInterviewsChart`
  - `frontend/src/components/dashboard/TopAgents.tsx: TopAgentsChart`
- Tooltips and responsive layout are preserved. Bars use gradient fills and rounded corners.
- Tests added for both chart components under `frontend/src/components/dashboard/__tests__`.

Security and hygiene:
- Frontend sanitizes user-provided HTML via `dompurify` where applicable.
- All Node.js code uses ESM `import` syntax (no `require`).
- CORS, HTTPS, auth, and OWASP basics are handled in backend middleware and routes.
