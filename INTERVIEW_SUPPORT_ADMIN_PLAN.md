# Plan: Interview Support Admin — dailyDashboard Integration

## Context
The interview support pipeline (Outlook → Kafka → intervue → auto-assign) runs headlessly with no admin visibility or manual control. Admins need a UI to: see all tasks, catch emails that never made it to MongoDB, retry failed auto-assignments, and view per-task processing logs — all with single-click actions. This adds a new admin-only section to dailyDashboard without touching the intervue or auto-assign services.

---

## New Environment Variables (dashboard backend `.env`)

```
AUTO_ASSIGN_URL=http://auto-assign-auto-reply-1:4928
PICA_SECRET_KEY=<same as auto-assign .env>
PICA_OUTLOOK_CONNECTION_KEY=<live::outlook-mail::default::cff42473b048454b9ae31cd9a0d59177>
POWER_AUTOMATE_URL=<same PA URL used in push scripts>
KAFKA_REST_URL=https://pkc-921jm.us-east-2.aws.confluent.cloud/kafka/v3/clusters/lkc-k3wo72/topics/intervue/records
KAFKA_REST_AUTH=Basic NVRJTk5aNERZSFZXM1dVWDpjZmx0M3c3ckN5dWsrc3F5VTFrQ2tJT0lNNlRMcjhmT2FYbVBuUTREY2I3b0MwVWdNdEdGTWtsUVVCTzVYK21R
```

---

## Files to Create (6)

| File | Purpose |
|------|---------|
| `backend/src/services/interviewSupportAdminService.js` | All MongoDB + Pica + Kafka logic |
| `backend/src/controllers/interviewSupportAdminController.js` | HTTP handlers via `asyncHandler` |
| `backend/src/routes/interviewSupportAdmin.js` | Route file with auth guards |
| `frontend/src/components/admin/InterviewSupportTaskList.tsx` | Filterable task table |
| `frontend/src/components/admin/InterviewSupportTaskDetail.tsx` | Task detail Sheet with actions |
| `frontend/src/pages/AdminInterviewSupport.tsx` | Page with 4 tabs |

## Files to Modify (5)

| File | Change |
|------|--------|
| `backend/src/config/index.js` | Add `autoAssign`, `pica`, `kafka` config keys |
| `backend/src/routes/index.js` | Mount `router.use('/admin/interview-support', ...)` |
| `backend/src/index.js` | Call `interviewSupportAdminService.setupRealtimeUpdates(io)` in `setupSocket()` |
| `frontend/src/App.tsx` | Add `<Route path="/admin/interview-support" element={<AdminInterviewSupportPage />} />` inside `<AuthorizedRoute>` |
| `frontend/src/components/layout/Sidebar.tsx` | Add nav item in the `normalizedRole === 'admin'` block alongside Performance |

---

## Step 1 — Config (`backend/src/config/index.js`)

Add three keys at the bottom of the `config` object (before the closing brace), following the existing `fireflies` pattern:

```js
autoAssign: {
  url: process.env.AUTO_ASSIGN_URL || 'http://localhost:4928',
},
pica: {
  secretKey: process.env.PICA_SECRET_KEY || '',
  outlookConnectionKey: process.env.PICA_OUTLOOK_CONNECTION_KEY || '',
  actionId: 'conn_mod_def::GCorx9pDnxY::58M00d9DQI-jjQJC7z7JaQ',
  baseUrl: 'https://api.picaos.com/v1/passthrough',
  powerAutomateUrl: process.env.POWER_AUTOMATE_URL || '',
},
kafka: {
  restUrl: process.env.KAFKA_REST_URL || '',
  restAuth: process.env.KAFKA_REST_AUTH || '',
},
```

---

## Step 2 — Backend Service (`interviewSupportAdminService.js`)

Single class instance exported as `interviewSupportAdminService`. Uses `database.getCollection()` (same as `taskService.js`). All methods are `async`.

### Method list

#### `setupRealtimeUpdates(io)` 
Stores `this.io = io`. Called from `index.js` after socket setup.

#### `listTasks({ page, limit, status, candidateName, dateFrom, dateTo })`
- Collection: `taskBody`
- Filter on `status`, `'Candidate Name'` (regex), `receivedDateTime` (range)
- Sort: `{ receivedDateTime: -1 }`
- Project out `body` and `replies` (heavy fields, not needed in list)
- Returns `{ tasks, total, page, limit }`

#### `getTaskDetail(taskId)`
- Validates `ObjectId`, throws 400/404 as needed
- Fetches full `taskBody` doc (including `body`, `replies`)
- Fetches `auditLog` docs where `subject === task.subject`, sorted `{ timestamp: 1 }`
- Returns `{ task, auditLogs }`

#### `updateTaskStatus(taskId, newStatus, adminEmail)`
- Validates status against `['Pending','Assigned','Acknowledged','Completed','Cancelled','Not Done','Rescheduled']`
- `findOneAndUpdate` with `$set: { status, _adminStatusOverride: { by, at } }`, `returnDocument: 'after'`
- Emits `this.io?.emit('interviewSupportTaskUpdated', { taskId, status, updatedAt })`
- Returns updated doc

#### `retryAutoAssign(taskId, adminEmail)`
- Loads task, validates `task.assignedTo` exists (422 if missing)
- `fetch(config.autoAssign.url + '/api/reply', { method:'POST', body: JSON.stringify({ subject, targetTo: task.assignedTo, customBodyHtml }) })`
- AbortSignal.timeout(30000); treats 5xx as 502
- Returns `{ autoAssignResult, task }`

#### `getUnprocessedEmails(date)`  ← **NEW — for "not in DB" requirement**
- `date` defaults to today (ISO date string)
- Builds date range: `dateFrom = <date>T00:00:00Z`, `dateTo = <date+1>T00:00:00Z`
- **Fetches from Outlook via Pica** (using `config.pica` credentials):
  ```
  GET /v1/passthrough/me/mailFolders/Inbox/messages
  ?$filter=contains(subject,'Interview Support - ') and receivedDateTime ge {dateFrom} and receivedDateTime lt {dateTo}
  &$top=500
  ```
  Handles `@odata.nextLink` pagination (same `graph_nextlink_to_pica` conversion logic used in push scripts)
- **Fetches existing subjects from MongoDB** `taskBody` for that date range
- Filters to originals only: `subject.toLowerCase().startsWith('interview support -')` AND no `Re:` prefix
- Returns emails in Outlook but NOT in MongoDB: `{ unprocessed: [{ subject, sender, receivedDateTime, to, cc, rawBody }], date }`

#### `pushUnprocessedToKafka(emailsPayload)`  ← **NEW**
- `emailsPayload` is an array of `{ subject, rawBody, sender, to, cc, receivedDateTime }`
- For each email:
  1. **Clean body via Power Automate**: `POST config.pica.powerAutomateUrl` with `{ body: rawBody }` → `cleanedBody`
  2. **Push to Kafka REST API**: `POST config.kafka.restUrl` with `Authorization: config.kafka.restAuth`, payload:
     ```json
     { "key": { "type": "STRING", "data": subject },
       "value": { "type": "JSON", "data": { sender, body: cleanedBody, to, cc, receivedDateTime, subject } } }
     ```
- Returns `{ pushed: N, failed: [...subjects that errored] }`

#### `getFailedAutoAssigns(date)`  ← **NEW**
- Queries `auditLog` for `{ phase: 'AUTO_ASSIGN_FAILED', timestamp: { $gte: dateFrom, $lt: dateTo } }`
- Groups by `subject` (take most recent failure per subject)
- Looks up corresponding `taskBody` docs for each subject
- Returns `{ failedTasks: [{ subject, task, lastFailure: auditLog doc, failureCount }] }`

#### `getStats(date)`  ← **NEW**
- Counts `taskBody` docs grouped by `status` for given date
- Counts `auditLog` by `phase` for given date (AUTO_ASSIGN_SUCCESS, AUTO_ASSIGN_FAILED, CREATED, etc.)
- Returns `{ statusBreakdown: {Pending:N,...}, auditPhaseBreakdown: {AUTO_ASSIGN_SUCCESS:N,...}, total }`

---

## Step 3 — Controller (`interviewSupportAdminController.js`)

All methods use `asyncHandler`. Pattern follows existing controllers exactly.

```
listTasks          → GET  /tasks
getTaskDetail      → GET  /tasks/:taskId
updateTaskStatus   → PATCH /tasks/:taskId/status
retryAutoAssign    → POST /tasks/:taskId/retry-assign
getUnprocessed     → GET  /unprocessed?date=YYYY-MM-DD
pushUnprocessed    → POST /unprocessed/push  body: { emails: [...] }
getFailedAssigns   → GET  /failed-assigns?date=YYYY-MM-DD
getStats           → GET  /stats?date=YYYY-MM-DD
```

`req.user.email` is passed to service methods that need it (from `authenticateHTTP` middleware).

---

## Step 4 — Route File (`interviewSupportAdmin.js`)

```js
router.use(authenticateHTTP);
router.use(requireHTTPRole('admin'));

router.get('/tasks',                    controller.listTasks);
router.get('/tasks/:taskId',            controller.getTaskDetail);
router.patch('/tasks/:taskId/status',   controller.updateTaskStatus);
router.post('/tasks/:taskId/retry-assign', controller.retryAutoAssign);
router.get('/unprocessed',              controller.getUnprocessed);
router.post('/unprocessed/push',        controller.pushUnprocessed);
router.get('/failed-assigns',           controller.getFailedAssigns);
router.get('/stats',                    controller.getStats);
```

Mounted in `routes/index.js` as `router.use('/admin/interview-support', interviewSupportAdminRoutes)` — **before the catch-all 404 handler**.

---

## Step 5 — Socket.IO wiring (`index.js`)

In `Application.setupSocket()`, after `taskService.setupRealtimeUpdates(this.socketManager.getIO())`:

```js
import { interviewSupportAdminService } from './services/interviewSupportAdminService.js';
// ...
interviewSupportAdminService.setupRealtimeUpdates(this.socketManager.getIO());
```

**Event emitted:** `interviewSupportTaskUpdated` → `{ taskId, status, updatedAt }`  
**Frontend listens:** invalidates `['interviewSupportTasks']` query on receipt

---

## Step 6 — Frontend Page (`AdminInterviewSupport.tsx`)

Four-tab layout inside `DashboardLayout`. Admin check via `localStorage.getItem('role') === 'admin'`. Non-admin gets the same access-denied card pattern from `AdminAlerts.tsx`.

### Tab 1: "All Tasks"
Component: `InterviewSupportTaskList`
- Filter bar: status `Select`, candidate name `Input`, date range (two `Input type="date"`)
- Table columns: Candidate Name | Technology | End Client | Round | Interview Date/Time | Status (badge) | Assigned To | Received | Actions
- Status badge colours: Pending→yellow, Assigned/Acknowledged→blue, Completed→green, Cancelled/Not Done→red, Rescheduled→grey
- "View" button opens `InterviewSupportTaskDetail` Sheet
- Socket.IO: listens `interviewSupportTaskUpdated` → `queryClient.invalidateQueries`
- Pagination using existing `/components/ui/pagination.tsx`
- TanStack Query key: `['interviewSupportTasks', page, filters]`

### Tab 2: "Unprocessed"
- Date picker (default today)
- "Scan Outlook" button → calls `GET /api/admin/interview-support/unprocessed?date=...`
- Shows table of emails found in Outlook but NOT in DB: Subject | Sender | Received | To/CC
- Checkbox per row + "Push Selected to Kafka" button (or "Push All" for the whole day)
- `useMutation` → `POST /api/admin/interview-support/unprocessed/push` with `{ emails: selectedEmails }`
- Shows per-email success/failure in a result toast or inline badge after push
- TanStack Query key: `['interviewSupportUnprocessed', date]`

### Tab 3: "Failed Auto-Assigns"
- Date picker (default today)
- Table: Candidate Name | Subject | Status | Last Failure Reason | Failure Count | Actions
- "Retry Auto-Assign" button per row → `POST /tasks/:taskId/retry-assign`
- `AlertDialog` confirmation before firing
- After success: invalidates both `['failedAutoAssigns']` and `['interviewSupportTasks']`
- TanStack Query key: `['failedAutoAssigns', date]`

### Tab 4: "Processing Logs"
- Date picker (default today)
- Stats cards row (from `GET /stats`): Total Tasks | Pending | Assigned | Completed | Auto-Assign Successes | Auto-Assign Failures
- Below: searchable audit log table across all tasks for the day — Phase | Subject | Detail | Level (badge) | Timestamp
- Level badge: info→grey, warn→yellow, error→red
- TanStack Query key: `['interviewSupportStats', date]`

---

## Step 7 — Task Detail Sheet (`InterviewSupportTaskDetail.tsx`)

Radix `Sheet` (already in `components/ui/sheet.tsx`). Opens when `taskId` is truthy.

Three inner `Tabs`:
1. **Details** — Two-column grid: all `taskBody` fields (Candidate Name, Technology, End Client, Round, Job Title, Email, Contact, Date/Time, Assigned To, Status, Sender). Full `body` in `ScrollArea` with `<pre>` formatting.
2. **Replies** — Timeline list from `task.replies[]`. Each reply card: sender, timestamp, body text.
3. **Audit Trail** — Timeline from `auditLogs[]`. Each entry: phase badge, level colour, detail text, timestamp. Phases like AUTO_ASSIGN_FAILED shown in red.

Action bar at Sheet bottom:
- **Status override**: `Select` (all valid statuses) + "Update" `Button` → `PATCH /tasks/:taskId/status`
- **Retry Auto-Assign**: `Button` (shown when status is `Pending` or `Assigned`) → `POST /tasks/:taskId/retry-assign` with `AlertDialog` confirmation

---

## Step 8 — Sidebar (`Sidebar.tsx`)

In the `normalizedRole === 'admin'` block (alongside Performance), add:

```tsx
<NavItem
  icon={HeadphonesIcon}   // import from lucide-react
  label="Interview Support"
  href="/admin/interview-support"
  isOpen={isOpen}
/>
```

Place it **after** the Performance `NavItem`.

---

## Step 9 — App Router (`App.tsx`)

Inside `<Route element={<AuthorizedRoute />}>`, after `/admin/performance`:

```tsx
<Route path="/admin/interview-support" element={<AdminInterviewSupportPage />} />
```

---

## API Summary

All endpoints under `/api/admin/interview-support/`, auth: `Bearer token` + `role === admin`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks` | Paginated task list with filters |
| GET | `/tasks/:taskId` | Full task detail + audit logs |
| PATCH | `/tasks/:taskId/status` | Admin status override |
| POST | `/tasks/:taskId/retry-assign` | Proxy retry to auto-assign service |
| GET | `/unprocessed?date=` | Outlook emails not in MongoDB |
| POST | `/unprocessed/push` | Clean via PA + push to Kafka |
| GET | `/failed-assigns?date=` | Tasks with AUTO_ASSIGN_FAILED audit entries |
| GET | `/stats?date=` | Status counts + audit phase breakdown |

---

## MongoDB Queries Reference

```js
// List tasks
db.taskBody.find(filter).sort({ receivedDateTime: -1 }).skip(skip).limit(20)
  .project({ body: 0, replies: 0 })

// Detail
db.taskBody.findOne({ _id: new ObjectId(taskId) })
db.auditLog.find({ subject: task.subject }).sort({ timestamp: 1 })

// Failed assigns
db.auditLog.find({ phase: 'AUTO_ASSIGN_FAILED', timestamp: { $gte, $lt } })
  .sort({ timestamp: -1 })

// Stats
db.taskBody.aggregate([{ $match: { receivedDateTime: { $gte, $lt } } },
  { $group: { _id: '$status', count: { $sum: 1 } } }])
db.auditLog.aggregate([{ $match: { timestamp: { $gte, $lt } } },
  { $group: { _id: '$phase', count: { $sum: 1 } } }])
```

---

## Verification

1. `GET /api/admin/interview-support/tasks` with admin JWT → `{ success:true, tasks:[...], total:N }`
2. `GET /api/admin/interview-support/unprocessed?date=2026-04-27` → list of emails not in DB
3. `POST /api/admin/interview-support/unprocessed/push` with one email → Kafka gets the message, intervue processes it, taskBody doc appears within ~10s
4. `GET /api/admin/interview-support/failed-assigns` → tasks with AUTO_ASSIGN_FAILED entries
5. `POST /tasks/:taskId/retry-assign` → auto-assign service called, reply email sent
6. `PATCH /tasks/:taskId/status` → status updated, Socket.IO event fires, list auto-refreshes
7. Non-admin JWT on any endpoint → 403
8. Navigate to `/admin/interview-support` as admin → four tabs render
9. "Interview Support" link visible in sidebar only for admin role
