# CLAUDE.md — Daily Dashboard

AI assistant guide for this repository. Read this before making changes.

---

## Repository Overview

Daily Dashboard is a full-stack workforce management platform used by a staffing/recruiting organization. It tracks candidates, tasks, interviews, job matches, and team performance. The product has three deployable services:

| Service | Directory | Language/Runtime |
|---------|-----------|-----------------|
| Backend API | `backend/` | Node.js 22, ESM, Express 5 |
| Frontend SPA | `frontend/` | React 18, TypeScript, Vite 5 |
| Job Scraper | `scraper/` | Python 3.10, FastAPI |

Nginx (`nginx/`) sits in front of both app stacks as a reverse proxy. Blue/green zero-downtime deployments are managed by `deploy_blue.sh`, `deploy_green.sh`, and `green_to_blue.sh`.

---

## Branching Strategy

- Work on feature branches cut from `main` (e.g. `feat/my-feature`, `fix/my-bug`)
- Push to `origin/<feature-branch>` and open a PR targeting `main`
- Never push directly to `main`

---

## Quick Start

### Prerequisites
- Node.js 22, npm
- MongoDB (local or Atlas)
- Python 3.10+ (scraper only)
- Copy `.env.example` → `.env` and fill in secrets

### Backend
```bash
cd backend
npm install
npm start          # production-like: node src/index.js
npm test           # Jest unit + integration tests
```

### Frontend
```bash
cd frontend
npm install
npm run dev        # Vite dev server on http://localhost:5173
npm run build      # Production bundle
npm run lint       # ESLint
npm test           # Vitest + React Testing Library
```

### Full stack (Docker)
```bash
docker compose up --build
# Nginx on port $FRONTEND_PORT (default 8180)
```

---

## Architecture

### Backend (`backend/src/`)

```
config/          Environment, DB connection, New Relic init
constants/       Shared lookup tables (profileRoleDetails)
controllers/     HTTP request handlers — thin, delegate to services
events/          In-process domain event bus (eventBus.js, eventTypes.js)
jobs/            Scheduled background tasks (cron-like schedulers)
middleware/      auth, errorHandler, security, validation, performance
models/          Raw MongoDB drivers (NOT Mongoose ORM — native driver)
notifications/   Outbox pattern: orchestrator → outbox → delivery worker
routes/          Express routers assembled in routes/index.js
services/        Business logic — all heavy lifting lives here
sockets/         Socket.IO event handlers (auth, tasks, candidates)
utils/           logger, logflare, emailSignature, posthog
```

**Key architectural patterns:**
- **No Mongoose** — uses native MongoDB driver (`mongodb` package) with manual index creation.
- **Service layer is the source of truth** — controllers call services, never query DB directly.
- **ESM only** — all files use `import`/`export`, no `require()`.
- **Event bus** — domain events (`DomainEvents.*`) flow through `eventBus.js`; the notification orchestrator subscribes to them and writes to the `notification_outbox` collection.
- **Notification outbox pattern** — `notificationOrchestrator` creates outbox documents; `notificationDeliveryWorker` polls and fans out to Socket.IO subscriptions.

### Frontend (`frontend/src/`)

```
pages/           Route-level page components (lazy-loaded except critical paths)
components/
  ui/            shadcn/ui primitives (Radix UI wrapped in Tailwind)
  dashboard/     KPI charts, BranchCandidates, TopAgents, etc.
  layout/        DashboardLayout, Header, Sidebar
  shared/        Reusable widgets (ConveyorChart, TaskDetailDrawer, etc.)
  admin/         Admin-only views
  profile-hub/   ProfileHub tabs (Overview, Aging, Workload, etc.)
context/         NotificationContext (global notification state)
contexts/        MicrosoftConsentContext, UserProfileContext
hooks/           useAuth, useNotifications, useOnlineMeetingConsent, etc.
routes/          AuthorizedRoute (RBAC guard)
utils/           graphMail, notify, dateRanges, interviewNotification, etc.
config/          permissions.ts, comprehensivePermissions.ts, changelog.ts
```

**Key frontend patterns:**
- Heavy pages are **lazy-loaded** (`React.lazy`) — don't eagerly import large page components.
- UI primitives come from `frontend/src/components/ui/` (shadcn/ui). Always use these instead of bare Radix or HTML.
- **AuthorizedRoute** enforces both authentication (`localStorage.accessToken`) and role-based access. Role checks are case-insensitive (normalized to lowercase internally).
- Socket.IO connection handles real-time task updates, notifications, and token refresh.
- Auth tokens stored in `localStorage` (`accessToken`, `refreshToken`, `role`).
- `@tanstack/react-query` for server state; avoid mixing with raw `fetch` without a good reason.

### Scraper (`scraper/`)

FastAPI service (`server.py`) that wraps Python scraping scripts. Exposes:
- `POST /scrape` — LinkedIn/career-site scraping via Apify
- `POST /enrich-jd` — GPT-4o-mini JD enrichment (extracts YoE + job titles)
- `GET /health` — liveness probe

---

## Role System

Roles in use (lowercase internally, may be stored mixed-case):

| Role | Description |
|------|-------------|
| `admin` | Full access to all features and admin pages |
| `mm` | Marketing Manager |
| `mam` | Marketing Account Manager |
| `mlead` | Marketing Lead |
| `recruiter` | Recruiter |

Role-based access is enforced at:
1. **Backend middleware** — `requireRole()` in `backend/src/middleware/auth.js`
2. **Frontend route guard** — `AuthorizedRoute.tsx`
3. **Socket RBAC** — `backend/src/sockets/`

When adding new role-gated features, update both the backend route middleware **and** `AuthorizedRoute.tsx`.

---

## Key API Routes

All routes are mounted under `/api` prefix.

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/api/auth/login` | Returns `accessToken` + `refreshToken` |
| `GET` | `/api/tasks` | Today's tasks (role-filtered) |
| `POST` | `/api/tasks/today` | Log a task |
| `GET/POST` | `/api/candidates` | Candidate CRUD |
| `POST` | `/api/candidates/:id/interviewer-questions` | GPT extraction, rate-limited 3/6h |
| `POST` | `/api/tasks/:id/transcript-request` | Request transcript access |
| `POST` | `/api/support/interview` | Send interview support email via Graph |
| `POST` | `/api/graph/meetings` | Create Teams meeting |
| `GET` | `/api/dashboard/*` | KPI and analytics data |
| `GET` | `/api/notifications` | Notification list |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/docs/openapi.json` | OpenAPI 3.1 spec |

WebSocket events (Socket.IO):
- `taskCreated` / `taskUpdated` — real-time task pushes
- `candidateNotifications:subscribe` — subscribe to branch/recruiter/expert scope
- `notifications:new` — delivered notifications
- `refresh` (emit) — token refresh

---

## Database

MongoDB collections (accessed via native driver, not Mongoose):

| Collection | Model file | Notes |
|-----------|-----------|-------|
| `users` | `models/User.js` | Email is always normalized to lowercase |
| `taskBody` | `models/Task.js` | Main task/interview records |
| `candidateDetails` | `models/Candidate.js` | Candidate profiles |
| `refreshTokens` | `models/RefreshToken.js` | JWT refresh tokens |
| `rolePermissions` | `models/RolePermission.js` | Dynamic role permissions |
| `transcriptRequests` | `models/TranscriptRequest.js` | Transcript access requests |
| `notification_outbox` | (notifications/) | TTL-indexed, purged automatically |
| `perfMetrics` | (inline in routes) | 24h performance telemetry |

**Important:** All email lookups must use lowercase comparisons. `UserModel.findUserDocumentByEmailCaseInsensitive()` handles this safely.

---

## Environment Variables

Minimum required for local dev:

```ini
# backend/.env
MONGODB_URI=mongodb://localhost:27017/daily-dashboard
PORT=3004
JWT_SECRET=<random>
FRONTEND_ORIGIN=http://localhost:5173

# frontend/.env (or set via shell)
VITE_API_URL=http://localhost:3004
```

Full reference is in `.env.example` and `README.md`.

---

## Testing

### Backend (Jest)
```bash
cd backend
# Requires: MONGODB_URI, JWT_SECRET, TEST_USER_EMAIL, TEST_USER_PASSWORD
npm test
```
- Test files live in `backend/test/` and `backend/src/**/__tests__/`
- Integration tests use a real MongoDB instance
- Seed test fixtures: `node scripts/seed-test-data.mjs`

### Frontend (Vitest + React Testing Library)
```bash
cd frontend
npm test
```
- Test files co-located with components: `*.test.tsx` / `*.test.ts`
- Tests in `__tests__/` subdirectories for chart components

### CI (GitHub Actions)
Workflows in `.github/workflows/ci.yml`:
- `backend-tests` — spins up MongoDB 7, seeds data, runs `npm test`
- `frontend-tests` — runs `npm test` with `VITE_API_URL` set

---

## Code Conventions

### General
- **No `require()`** — ESM (`import`/`export`) everywhere in Node.js code.
- **No comments describing what code does** — code is self-documenting. Only add comments for non-obvious WHY (workarounds, hidden constraints).
- Prefer editing existing files to creating new ones.
- No TypeScript in backend — plain JS with JSDoc-style types where needed.
- TypeScript is enforced in frontend — don't use `any` unless unavoidable.

### Backend
- New routes → add to the appropriate file in `backend/src/routes/`, register in `routes/index.js`.
- New business logic → add to `backend/src/services/`, never put logic directly in controllers.
- New domain events → add to `eventTypes.js` first, then emit from the relevant service.
- Use `logger` (from `utils/logger.js`) for all logging — no bare `console.log`.
- HTTP responses use `{ success: true/false, data/error }` envelope.
- Rate-limited endpoints use Express middleware (not DIY counters in controllers).

### Frontend
- Always use `frontend/src/components/ui/` primitives before reaching for raw HTML.
- Page routing uses `react-router-dom` v6 — file-based convention is not used.
- For role checks in components: `localStorage.getItem('role')?.toLowerCase()`.
- Use the `Toaster` component (via `components/ui/toaster.tsx`) for toast notifications.
- Use `dompurify` when rendering any user-supplied HTML.
- Avoid adding `console.log` — use the `trackError` utility for error reporting.
- Tailwind CSS — no inline `style` attributes unless absolutely necessary.

### Naming
- Backend service files: `camelCase.js` (e.g., `candidateService.js`)
- Frontend component files: `PascalCase.tsx`
- Frontend hooks: `useHookName.ts`
- Test files: `*.test.js` (backend), `*.test.tsx`/`*.test.ts` (frontend)

---

## Deployment

### Blue/Green Zero-Downtime
```bash
# Deploy to the inactive (green) stack:
./deploy_green.sh

# Cut traffic from blue → green once green is healthy:
./green_to_blue.sh

# Or deploy directly to blue:
./deploy_blue.sh
```

The nginx config in `nginx/conf.d/` uses `include` directives for upstream files (`backend.active.conf`, `frontend.active.conf`) that the switch scripts swap out atomically.

### Docker
Each service has its own `Dockerfile`. The root `docker-compose.yml` runs:
- `dailydb-gateway` (nginx, port `$FRONTEND_PORT`)
- `dailydb-backend-blue` + `dailydb-backend-green`
- `dailydb-frontend-blue` + `dailydb-frontend-green`
- `dailydb-scraper` (FastAPI, internal port 8001)

---

## External Integrations

| Service | Used for | Config vars |
|---------|----------|-------------|
| MongoDB Atlas | Primary database | `MONGODB_URI` |
| OpenAI / GPT | Report assistant, interview question extraction, JD enrichment | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_REPORTING_MODEL` |
| Microsoft Graph / Azure AD | Teams meetings, mail sending, MSAL auth | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `VITE_AZURE_CLIENT_ID` |
| Fireflies.ai | Transcript ingestion | (firefliesBotScheduler) |
| Apify | LinkedIn/career-site job scraping | `APIFY_TOKEN` |
| New Relic | APM for backend + frontend | `NEW_RELIC_LICENSE_KEY`, `NEW_RELIC_APP_NAME` |
| Logflare | Debug telemetry | `LOGFLARE_SOURCE_ID`, `LOGFLARE_API_KEY` |
| PostHog | Frontend analytics | `VITE_PUBLIC_POSTHOG_KEY` |
| AWS S3 | Resume storage | `@aws-sdk/client-s3` |
| Appwrite | Supplemental storage | `node-appwrite` |

---

## Security Notes

- Backend sanitizes all request inputs via `middleware/security.js` — regex patterns catch script injection and SQL injection patterns.
- Rate limiting: 200 req/min per IP (custom middleware) + DDoS protection.
- Frontend sanitizes user HTML with `dompurify`.
- JWT access tokens are short-lived; refresh tokens are stored in MongoDB with rotation.
- CORS is restricted to `FRONTEND_ORIGIN` env var.
- Interview support emails use duplicated-subject detection (returns 409 on duplicate).
- Transcript access requires explicit admin approval (`TranscriptRequest` workflow).

---

## Docs Directory

| File | Purpose |
|------|---------|
| `docs/PLAN-*.md` | Feature planning docs |
| `docs/WALKTHROUGH-*.md` | Feature implementation walkthroughs |
| `INTERVIEW_SUPPORT_ADMIN_PLAN.md` | Admin interview support feature plan |
| `.agent/ARCHITECTURE.md` | AI agent toolkit reference (Antigravity Kit) |
| `uat_plan.md` | UAT checklist |
