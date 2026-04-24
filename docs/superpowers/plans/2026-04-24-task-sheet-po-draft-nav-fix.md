# Task Sheet + PO Draft + Tab Nav Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a universal slide-in task sheet used everywhere tasks appear, a PO draft form that creates an Outlook draft via Microsoft Graph, and fix tab navigation so Back returns to the correct tab.

**Architecture:** Three loosely coupled features sharing a common entry point — `TaskSheet` is a standalone component wired into every task list; `PODraftSheet` is triggered from `TaskSheet` and candidate profile; tab state moves from React `useState` to URL query params so the browser history stack carries it.

**Tech Stack:** React 18 + TypeScript, Shadcn UI `Sheet`, React Router `useSearchParams`, Node.js/Express backend, MongoDB Atlas (`interviewSupport` DB), Microsoft Graph API OBO flow via `@azure/msal-node`.

---

## File Map

### New Files
| File | Purpose |
|---|---|
| `frontend/src/components/shared/TaskSheet.tsx` | Slide-in sheet showing task details + email thread |
| `frontend/src/components/shared/PODraftSheet.tsx` | PO draft form — auto-fill + manual fields + Outlook draft |
| `backend/src/controllers/poController.js` | PO CRUD + `POST /:id/draft-email` via Graph |
| `backend/src/routes/po.js` | Express router for `/api/po` |

### Modified Files
| File | Change |
|---|---|
| `backend/src/services/graphMailService.js` | Add `createDraft(userAssertion, payload)` method |
| `backend/src/config/index.js` | Add `Mail.ReadWrite` to `mailScopes` fallback |
| `backend/src/routes/index.js` | Register `poRoutes` at `/po` |
| `frontend/src/components/profile-hub/ProfileHub.tsx` | URL tab sync via `useSearchParams` |
| `frontend/src/pages/DashboardV2.tsx` | URL tab sync via `useSearchParams` |
| `frontend/src/components/dashboard/v2/ExpertAnalytics.tsx` | Replace `TaskDetailDrawer` with `TaskSheet` |
| `frontend/src/components/dashboard/v2/RecruiterAnalytics.tsx` | Replace `TaskDetailDrawer` with `TaskSheet` |
| `frontend/src/pages/CandidateDetailPage.tsx` | Add `TaskSheet` on interview click + "Create PO" button |
| `frontend/src/pages/TasksToday.tsx` | Add `selectedTaskId` state + `TaskSheet` |

---

## Task 1: URL Tab State — ProfileHub

**Files:**
- Modify: `frontend/src/components/profile-hub/ProfileHub.tsx`

- [ ] **Step 1: Replace `useState` tab with `useSearchParams`**

Open `frontend/src/components/profile-hub/ProfileHub.tsx`. Replace:
```tsx
import { useState } from 'react';
```
with:
```tsx
import { useSearchParams } from 'react-router-dom';
```

Replace the state declaration and handler:
```tsx
// REMOVE:
const [activeTab, setActiveTab] = useState('overview');

// ADD:
const [searchParams, setSearchParams] = useSearchParams();
const activeTab = searchParams.get('tab') ?? 'overview';
const setActiveTab = (value: string) =>
  setSearchParams({ tab: value }, { replace: true });
```

The `<Tabs value={activeTab} onValueChange={setActiveTab}>` call stays identical — no other changes needed.

- [ ] **Step 2: Verify in browser**

Navigate to `/profile-hub`, click "Recruiters" tab → URL becomes `/profile-hub?tab=recruiters`. Press Back → returns to previous URL with correct tab. No page reload.

- [ ] **Step 3: Commit**
```bash
git add frontend/src/components/profile-hub/ProfileHub.tsx
git commit -m "fix: persist ProfileHub active tab in URL query param"
```

---

## Task 2: URL Tab State — DashboardV2

**Files:**
- Modify: `frontend/src/pages/DashboardV2.tsx`

- [ ] **Step 1: Add `useSearchParams` import**

In `frontend/src/pages/DashboardV2.tsx`, add to the react-router-dom import (it already imports from there):
```tsx
import { useSearchParams } from 'react-router-dom';
```

- [ ] **Step 2: Replace `defaultValue` with controlled tab**

Find the `<Tabs defaultValue="overview"` line (around line 162). Replace the block:
```tsx
// REMOVE defaultValue approach — replace with controlled:
// Old: <Tabs defaultValue="overview" className="space-y-4">
```

Add inside the component function (after existing `useState` declarations):
```tsx
const [searchParams, setSearchParams] = useSearchParams();
const activeTab = searchParams.get('tab') ?? 'overview';
const handleTabChange = (value: string) =>
  setSearchParams({ tab: value }, { replace: true });
```

Change the Tabs element:
```tsx
<Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
```

- [ ] **Step 3: Verify in browser**

Navigate to `/dashboard-v2`, click "Expert Stats" → URL becomes `?tab=expert`. Press Back → returns to `?tab=overview`. No page reload.

- [ ] **Step 4: Commit**
```bash
git add frontend/src/pages/DashboardV2.tsx
git commit -m "fix: persist DashboardV2 active tab in URL query param"
```

---

## Task 3: Add `createDraft` to graphMailService

**Files:**
- Modify: `backend/src/services/graphMailService.js`
- Modify: `backend/src/config/index.js`

- [ ] **Step 1: Add `Mail.ReadWrite` to config fallback**

In `backend/src/config/index.js`, find the `mailScopes` fallback (around line 119-124):
```js
// BEFORE:
return ['https://graph.microsoft.com/Mail.Send'];

// AFTER:
return [
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/Mail.ReadWrite',
];
```

- [ ] **Step 2: Add `createDraft` method to GraphMailService class**

In `backend/src/services/graphMailService.js`, add this method inside the `GraphMailService` class, after `sendApplicationMail`:

```js
async createDraft(userAssertion, draftPayload) {
  const accessToken = await this.acquireOnBehalfOfToken(userAssertion);

  const response = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(draftPayload),
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch (err) {
    logger.error('Failed to parse Graph createDraft response', { error: err.message });
    parsed = text;
  }

  if (!response.ok) {
    throw new GraphMailRequestError(
      'Microsoft Graph createDraft request failed',
      response.status,
      parsed
    );
  }

  logger.info('Outlook draft created', { messageId: parsed.id });
  return parsed; // includes parsed.webLink for opening in Outlook
}
```

- [ ] **Step 3: Commit**
```bash
git add backend/src/services/graphMailService.js backend/src/config/index.js
git commit -m "feat: add createDraft method to graphMailService, add Mail.ReadWrite scope"
```

---

## Task 4: Backend PO Controller + Routes

**Files:**
- Create: `backend/src/controllers/poController.js`
- Create: `backend/src/routes/po.js`
- Modify: `backend/src/routes/index.js`

- [ ] **Step 1: Create `poController.js`**

Create `backend/src/controllers/poController.js`:

```js
import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { graphMailService } from '../services/graphMailService.js';
import { logger } from '../utils/logger.js';
import { authenticateHTTP } from '../middleware/auth.js';

function bearerFrom(req) {
  const header = req.headers?.authorization || '';
  const match = /^Bearer\s+(.+)/i.exec(header);
  return match ? match[1] : '';
}

function buildEmailBody(po) {
  const poCount = po.poCount || {};
  const parts = [
    `Total – ${poCount.total ?? 0}`,
    poCount.ggr  ? `GGR – ${poCount.ggr}`   : null,
    poCount.lkn  ? `LKN – ${poCount.lkn}`   : null,
    poCount.ahm  ? `AHM – ${poCount.ahm}`   : null,
    poCount.lko  ? `LKO – ${poCount.lko}`   : null,
    poCount.uk   ? `UK – ${poCount.uk}`      : null,
  ].filter(Boolean).join(' | ');

  return [
    'Hello Team,',
    `Kindly find the PO details of ${po.candidateName}`,
    '',
    `Name of Candidate: ${po.candidateName}`,
    `Branch: ${po.branch || ''} | Company: SST/Vizva`,
    `PO Count: ${parts}`,
    `Email ID: ${po.emailId || ''}`,
    `Type of Job: ${po.jobType || ''}`,
    `Position: ${po.position || ''}`,
    `Implementation/End Client: ${po.endClient || ''}`,
    `Vendor: ${po.vendor || ''}`,
    `Rate: ${po.rate || ''}`,
    `Signup Date: ${po.signupDate ? new Date(po.signupDate).toLocaleDateString('en-GB') : ''}`,
    `Joining Date: ${po.joiningDate ? new Date(po.joiningDate).toLocaleDateString('en-GB') : ''}`,
    `Agreement: ${po.agreementPct ?? ''}% in ${po.agreementMonths ?? ''} Months / Upfront – $${po.upfrontAmount ?? ''} (NR)`,
    '',
    `Marketing Recruiter: ${po.recruiter || ''}`,
    `Interview Support Expert: ${po.interviewExpert || ''}`,
  ].join('\n');
}

class POController {
  async getCollection() {
    const db = database.getDb();
    return db.collection('poDetails');
  }

  // POST /api/po — create or upsert
  async createOrUpdate(req, res) {
    try {
      const col = await this.getCollection();
      const user = req.user;
      const body = req.body;

      if (!body.candidateName) {
        return res.status(400).json({ success: false, error: 'candidateName is required' });
      }

      const now = new Date();
      const doc = {
        candidateName:   body.candidateName,
        emailId:         body.emailId         || null,
        endClient:       body.endClient        || null,
        position:        body.position         || null,
        vendor:          body.vendor           || null,
        branch:          body.branch           || null,
        recruiter:       body.recruiter        || null,
        jobType:         body.jobType          || null,
        rate:            body.rate             || null,
        signupDate:      body.signupDate       ? new Date(body.signupDate)  : null,
        joiningDate:     body.joiningDate      ? new Date(body.joiningDate) : null,
        agreementPct:    body.agreementPct     != null ? Number(body.agreementPct)    : null,
        agreementMonths: body.agreementMonths  != null ? Number(body.agreementMonths) : null,
        upfrontAmount:   body.upfrontAmount    != null ? Number(body.upfrontAmount)   : null,
        poCount: {
          total: Number(body.poCount?.total ?? 0),
          ggr:   Number(body.poCount?.ggr   ?? 0),
          lkn:   Number(body.poCount?.lkn   ?? 0),
          ahm:   Number(body.poCount?.ahm   ?? 0),
          lko:   Number(body.poCount?.lko   ?? 0),
          uk:    Number(body.poCount?.uk    ?? 0),
        },
        interviewExpert: body.interviewExpert  || null,
        isDraft:         body.isDraft !== false,
        sourceTaskId:    body.sourceTaskId     ? new ObjectId(body.sourceTaskId)    : null,
        candidateId:     body.candidateId      ? new ObjectId(body.candidateId)     : null,
        updatedAt:       now,
      };

      let result;
      if (body._id) {
        // Update existing
        const { _id, ...update } = doc;
        result = await col.findOneAndUpdate(
          { _id: new ObjectId(body._id) },
          { $set: update },
          { returnDocument: 'after' }
        );
        return res.json({ success: true, po: result });
      } else {
        // Insert new
        doc.createdBy = user.email;
        doc.createdAt = now;
        const inserted = await col.insertOne(doc);
        return res.json({ success: true, po: { ...doc, _id: inserted.insertedId } });
      }
    } catch (err) {
      logger.error('POController.createOrUpdate error', { error: err.message });
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // GET /api/po — list with optional filters
  async list(req, res) {
    try {
      const col = await this.getCollection();
      const filter = {};
      if (req.query.branch)    filter.branch    = req.query.branch;
      if (req.query.recruiter) filter.recruiter = req.query.recruiter;
      if (req.query.isDraft !== undefined)
        filter.isDraft = req.query.isDraft === 'true';

      const page  = Math.max(1, parseInt(req.query.page  ?? '1',  10));
      const limit = Math.min(200, parseInt(req.query.limit ?? '50', 10));
      const skip  = (page - 1) * limit;

      const [items, total] = await Promise.all([
        col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
        col.countDocuments(filter),
      ]);

      return res.json({ success: true, data: items, total, page, limit });
    } catch (err) {
      logger.error('POController.list error', { error: err.message });
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // GET /api/po/:candidateId — get PO for a candidate
  async getByCandidateId(req, res) {
    try {
      const col = await this.getCollection();
      const po = await col.findOne({ candidateId: new ObjectId(req.params.candidateId) });
      return res.json({ success: true, po: po ?? null });
    } catch (err) {
      logger.error('POController.getByCandidateId error', { error: err.message });
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // DELETE /api/po/:id
  async remove(req, res) {
    try {
      const col = await this.getCollection();
      await col.deleteOne({ _id: new ObjectId(req.params.id) });
      return res.json({ success: true });
    } catch (err) {
      logger.error('POController.remove error', { error: err.message });
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // POST /api/po/:id/draft-email — create Outlook draft via Graph OBO
  async createDraftEmail(req, res) {
    try {
      const col = await this.getCollection();
      const po = await col.findOne({ _id: new ObjectId(req.params.id) });
      if (!po) return res.status(404).json({ success: false, error: 'PO not found' });

      const body = buildEmailBody(po);
      const draftPayload = {
        subject: `PO Details — ${po.candidateName}`,
        body: { contentType: 'Text', content: body },
      };

      const userAssertion = bearerFrom(req);
      const message = await graphMailService.createDraft(userAssertion, draftPayload);

      return res.json({
        success: true,
        messageId: message.id,
        webLink: message.webLink ?? null,
      });
    } catch (err) {
      logger.error('POController.createDraftEmail error', { error: err.message });
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}

export const poController = new POController();
```

- [ ] **Step 2: Create `po.js` routes**

Create `backend/src/routes/po.js`:

```js
import express from 'express';
import { authenticateHTTP } from '../middleware/auth.js';
import { poController } from '../controllers/poController.js';

const router = express.Router();

router.use(authenticateHTTP);

router.post('/',              (req, res) => poController.createOrUpdate(req, res));
router.get('/',               (req, res) => poController.list(req, res));
router.get('/:candidateId',   (req, res) => poController.getByCandidateId(req, res));
router.delete('/:id',         (req, res) => poController.remove(req, res));
router.post('/:id/draft-email', (req, res) => poController.createDraftEmail(req, res));

export default router;
```

- [ ] **Step 3: Register in routes index**

In `backend/src/routes/index.js`, add the import after the existing imports:
```js
import poRoutes from './po.js';
```

Add the route registration after `router.use('/dashboard', dashboardRoutes);`:
```js
router.use('/po', poRoutes);
```

- [ ] **Step 4: Deploy to Docker container**
```bash
docker cp backend/src/controllers/poController.js dailydb-backend-blue:/app/src/controllers/
docker cp backend/src/routes/po.js dailydb-backend-blue:/app/src/routes/
docker cp backend/src/routes/index.js dailydb-backend-blue:/app/src/routes/
docker cp backend/src/services/graphMailService.js dailydb-backend-blue:/app/src/services/
docker cp backend/src/config/index.js dailydb-backend-blue:/app/src/config/
docker restart dailydb-backend-blue
```

- [ ] **Step 5: Smoke test**
```bash
# Should return { success: true, data: [], total: 0, page: 1, limit: 50 }
curl -s -H "Authorization: Bearer <your_jwt>" http://localhost:3004/api/po | jq .
```

- [ ] **Step 6: Commit**
```bash
git add backend/src/controllers/poController.js backend/src/routes/po.js backend/src/routes/index.js
git commit -m "feat: add PO CRUD controller and routes with Graph draft-email endpoint"
```

---

## Task 5: TaskSheet Component

**Files:**
- Create: `frontend/src/components/shared/TaskSheet.tsx`

- [ ] **Step 1: Create `TaskSheet.tsx`**

Create `frontend/src/components/shared/TaskSheet.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Calendar, Clock, Building2, Briefcase, User, Mail,
  Layers, Users, ExternalLink, MessageSquare, FileText,
} from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useAuth, API_URL } from '@/hooks/useAuth';

// ── Types ────────────────────────────────────────────────────────────────────
interface TaskReply {
  body: string;
  from: string;
  receivedAt: string | null;
}

export interface TaskSheetPrefill {
  taskId: string;
  candidateId?: string | null;
  candidateName: string;
  emailId?: string;
  endClient?: string;
  position?: string;
  vendor?: string;
  branch?: string;
  recruiter?: string;
}

interface TaskFull {
  taskId: string;
  candidateId: string | null;
  candidateName: string;
  emailId: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  role: string;
  client: string;
  round: string;
  actualRound: string;
  status: string;
  vendor: string;
  recruiter: string;
  assignedTo: string;
  assignedAt: string | null;
  suggestions: string[];
  receivedAt: string | null;
  body: string;
  replies: TaskReply[];
  subject: string;
}

interface TaskSheetProps {
  taskId: string | null;
  onClose: () => void;
  onCreatePO?: (prefill: TaskSheetPrefill) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatEmail(email: string) {
  if (!email) return '';
  if (!email.includes('@')) return email;
  return email.split('@')[0].split(/[._]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}
function formatDate(d: string | null) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateTime(d: string | null) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_CLASS: Record<string, string> = {
  completed:   'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  done:        'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  selected:    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  cancelled:   'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300',
  rescheduled: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
};
function statusClass(s: string) {
  return STATUS_CLASS[(s || '').toLowerCase()] ?? 'bg-muted text-foreground border-border';
}

function Field({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-xs font-medium">{value}</div>
      </div>
    </div>
  );
}

function EmailBody({ text }: { text: string }) {
  if (!text) return null;
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return (
    <pre className="text-xs text-foreground/80 whitespace-pre-wrap break-words font-sans leading-relaxed">
      {cleaned}
    </pre>
  );
}

function ReplyBubble({ reply, index }: { reply: TaskReply; index: number }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold mt-0.5">
        {reply.from ? reply.from.charAt(0).toUpperCase() : '?'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-xs font-semibold">
            {reply.from
              ? (reply.from.includes('@') ? formatEmail(reply.from) : reply.from)
              : 'Unknown'}
          </span>
          {index === 0 && <Badge variant="secondary" className="text-[9px] px-1">Original</Badge>}
          {reply.receivedAt && (
            <span className="text-[10px] text-muted-foreground ml-auto">{formatDateTime(reply.receivedAt)}</span>
          )}
        </div>
        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          <EmailBody text={reply.body} />
        </div>
      </div>
    </div>
  );
}

function TaskSheetSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-6 w-48" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}
      </div>
      <Skeleton className="h-5 w-32" />
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-7 w-7 rounded-full shrink-0" />
          <Skeleton className="h-20 flex-1 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export function TaskSheet({ taskId, onClose, onCreatePO }: TaskSheetProps) {
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const [task, setTask] = useState<TaskFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) { setTask(null); setError(null); return; }
    setLoading(true);
    setError(null);
    authFetch(`${API_URL}/api/candidates/task/${taskId}?full=true`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) throw new Error(json.error);
        setTask(json.task);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [taskId, authFetch]);

  const handleCreatePO = () => {
    if (!task || !onCreatePO) return;
    onCreatePO({
      taskId: task.taskId,
      candidateId: task.candidateId,
      candidateName: task.candidateName,
      emailId: task.emailId,
      endClient: task.client,
      position: task.role,
      vendor: task.vendor,
      recruiter: task.recruiter,
    });
  };

  return (
    <Sheet open={!!taskId} onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto flex flex-col gap-0 p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="text-sm">
            {task ? task.candidateName : 'Task Details'}
          </SheetTitle>
          {task?.subject && (
            <p className="text-xs text-muted-foreground truncate">{task.subject}</p>
          )}
        </SheetHeader>

        {loading && <TaskSheetSkeleton />}
        {error && (
          <div className="p-4 text-sm text-destructive">{error}</div>
        )}

        {task && !loading && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Status + date strip */}
            <div className="flex flex-wrap items-center gap-2">
              {task.status && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${statusClass(task.status)}`}>
                  {task.status}
                </span>
              )}
              {task.date && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />{task.date}
                </span>
              )}
              {(task.startTime || task.endTime) && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {[task.startTime, task.endTime].filter(Boolean).join(' – ')}
                </span>
              )}
              {task.receivedAt && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {formatDateTime(task.receivedAt)}
                </span>
              )}
            </div>

            <Separator />

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3.5">
              <Field icon={Building2} label="Client"       value={task.client} />
              <Field icon={Briefcase} label="Job Title"    value={task.role} />
              <Field icon={Layers}    label="Round"        value={task.round} />
              <Field icon={Layers}    label="Actual Round" value={task.actualRound} />
              <Field icon={Building2} label="Vendor"       value={task.vendor} />
              <Field icon={Mail}      label="Candidate Email" value={task.emailId} />
              <Field icon={Mail}      label="Recruiter"
                value={task.recruiter ? (task.recruiter.includes('@') ? formatEmail(task.recruiter) : task.recruiter) : null} />
              <Field icon={User}      label="Expert"
                value={task.assignedTo ? (task.assignedTo.includes('@') ? formatEmail(task.assignedTo) : task.assignedTo) : null} />
              <Field icon={Clock}     label="Assigned At"  value={formatDate(task.assignedAt)} />
            </div>

            {/* Suggestions */}
            {task.suggestions.length > 0 && (
              <div className="pt-1">
                <div className="flex items-center gap-1.5 mb-2">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Expert Suggestions</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {task.suggestions.map((s, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px] px-1.5">{s}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Email thread */}
            {(task.body || task.replies.length > 0) && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">Email Thread</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {task.replies.length + (task.body ? 1 : 0)} message{task.replies.length + (task.body ? 1 : 0) !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-3">
                  {task.body && (
                    <ReplyBubble reply={{ body: task.body, from: task.recruiter, receivedAt: task.receivedAt }} index={0} />
                  )}
                  {task.body && task.replies.length > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[10px] text-muted-foreground">{task.replies.length} repl{task.replies.length === 1 ? 'y' : 'ies'}</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  )}
                  {task.replies.map((reply, i) => (
                    <ReplyBubble key={i} reply={reply} index={task.body ? i + 1 : i} />
                  ))}
                </div>
              </div>
            )}

            {!task.body && task.replies.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <FileText className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">No email thread for this task.</p>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {task && !loading && (
          <div className="border-t px-5 py-3 flex gap-2 shrink-0">
            {onCreatePO && (
              <Button variant="default" size="sm" className="text-xs gap-1.5 flex-1" onClick={handleCreatePO}>
                ＋ Create PO Draft
              </Button>
            )}
            {task.candidateId && (
              <Button variant="outline" size="sm" className="text-xs gap-1.5 flex-1"
                onClick={() => { onClose(); navigate(`/candidate/${task.candidateId}`); }}>
                <ExternalLink className="h-3.5 w-3.5" /> Candidate Profile
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-xs gap-1.5"
              onClick={() => { onClose(); navigate(`/task/${taskId}`); }}>
              Full Page
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**
```bash
cd frontend && npx tsc --noEmit 2>&1 | grep TaskSheet
```
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add frontend/src/components/shared/TaskSheet.tsx
git commit -m "feat: add universal TaskSheet slide-in component"
```

---

## Task 6: PODraftSheet Component

**Files:**
- Create: `frontend/src/components/shared/PODraftSheet.tsx`

- [ ] **Step 1: Create `PODraftSheet.tsx`**

Create `frontend/src/components/shared/PODraftSheet.tsx`:

```tsx
import { useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useAuth, API_URL } from '@/hooks/useAuth';
import type { TaskSheetPrefill } from './TaskSheet';

interface PODraftSheetProps {
  open: boolean;
  onClose: () => void;
  prefill: TaskSheetPrefill | null;
}

interface POCount {
  total: string; ggr: string; lkn: string; ahm: string; lko: string; uk: string;
}

interface POForm {
  jobType: string;
  rate: string;
  signupDate: string;
  joiningDate: string;
  agreementPct: string;
  agreementMonths: string;
  upfrontAmount: string;
  poCount: POCount;
  interviewExpert: string;
}

const EMPTY_FORM: POForm = {
  jobType: '',
  rate: '',
  signupDate: '',
  joiningDate: '',
  agreementPct: '',
  agreementMonths: '',
  upfrontAmount: '',
  poCount: { total: '', ggr: '', lkn: '', ahm: '', lko: '', uk: '' },
  interviewExpert: '',
};

export function PODraftSheet({ open, onClose, prefill }: PODraftSheetProps) {
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState<POForm>(EMPTY_FORM);
  const [savedPoId, setSavedPoId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [generatingDraft, setGeneratingDraft] = useState(false);

  const update = (field: keyof POForm, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const updateCount = (field: keyof POCount, value: string) =>
    setForm(prev => ({ ...prev, poCount: { ...prev.poCount, [field]: value } }));

  const buildPayload = () => ({
    candidateName:   prefill?.candidateName ?? '',
    emailId:         prefill?.emailId ?? '',
    endClient:       prefill?.endClient ?? '',
    position:        prefill?.position ?? '',
    vendor:          prefill?.vendor ?? '',
    branch:          prefill?.branch ?? '',
    recruiter:       prefill?.recruiter ?? '',
    candidateId:     prefill?.candidateId ?? null,
    sourceTaskId:    prefill?.taskId ?? null,
    jobType:         form.jobType,
    rate:            form.rate,
    signupDate:      form.signupDate || null,
    joiningDate:     form.joiningDate || null,
    agreementPct:    form.agreementPct   ? Number(form.agreementPct)   : null,
    agreementMonths: form.agreementMonths ? Number(form.agreementMonths) : null,
    upfrontAmount:   form.upfrontAmount  ? Number(form.upfrontAmount)  : null,
    poCount: {
      total: Number(form.poCount.total || 0),
      ggr:   Number(form.poCount.ggr   || 0),
      lkn:   Number(form.poCount.lkn   || 0),
      ahm:   Number(form.poCount.ahm   || 0),
      lko:   Number(form.poCount.lko   || 0),
      uk:    Number(form.poCount.uk    || 0),
    },
    interviewExpert: form.interviewExpert,
    isDraft: true,
  });

  const handleSave = async (): Promise<string | null> => {
    setSaving(true);
    try {
      const payload = savedPoId ? { ...buildPayload(), _id: savedPoId } : buildPayload();
      const res = await authFetch(`${API_URL}/api/po`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      const id = json.po._id?.toString() ?? savedPoId;
      setSavedPoId(id);
      toast({ title: 'Draft saved' });
      return id;
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' });
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateDraft = async () => {
    setGeneratingDraft(true);
    try {
      // Auto-save first if needed
      let poId = savedPoId;
      if (!poId) poId = await handleSave();
      if (!poId) return;

      const res = await authFetch(`${API_URL}/api/po/${poId}/draft-email`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      toast({
        title: 'Outlook draft created',
        description: json.webLink
          ? 'Draft is in your Outlook Drafts folder.'
          : 'Check your Outlook Drafts folder.',
        action: json.webLink
          ? { label: 'Open in Outlook', onClick: () => window.open(json.webLink, '_blank') }
          : undefined,
      });
    } catch (e: any) {
      toast({ title: 'Draft creation failed', description: e.message, variant: 'destructive' });
    } finally {
      setGeneratingDraft(false);
    }
  };

  const handleClose = () => {
    setForm(EMPTY_FORM);
    setSavedPoId(null);
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={open => !open && handleClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto flex flex-col gap-0 p-0" side="right">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="text-sm">Create PO Draft</SheetTitle>
          <SheetDescription className="text-xs">
            {prefill?.candidateName} — auto-filled from task
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Auto-filled section */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-emerald-600 mb-3">
              Auto-filled from task
            </div>
            <div className="grid grid-cols-2 gap-3 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-lg p-3">
              {[
                ['Candidate', prefill?.candidateName],
                ['Email', prefill?.emailId],
                ['End Client', prefill?.endClient],
                ['Position', prefill?.position],
                ['Vendor', prefill?.vendor],
                ['Recruiter', prefill?.recruiter],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
                  <div className="text-xs font-medium truncate">{value || '—'}</div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Manual fields */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-violet-600 mb-3">
              Fill Manually
            </div>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Job Type</Label>
                <Select value={form.jobType} onValueChange={v => update('jobType', v)}>
                  <SelectTrigger className="h-8 text-xs mt-1">
                    <SelectValue placeholder="W2 / C2C / FTE" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="W2">W2</SelectItem>
                    <SelectItem value="C2C">C2C</SelectItem>
                    <SelectItem value="FTE">FTE</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs">Rate</Label>
                <Input className="h-8 text-xs mt-1" placeholder="e.g. $98,000 / Annum"
                  value={form.rate} onChange={e => update('rate', e.target.value)} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Signup Date</Label>
                  <Input type="date" className="h-8 text-xs mt-1"
                    value={form.signupDate} onChange={e => update('signupDate', e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Joining Date</Label>
                  <Input type="date" className="h-8 text-xs mt-1"
                    value={form.joiningDate} onChange={e => update('joiningDate', e.target.value)} />
                </div>
              </div>

              <div>
                <Label className="text-xs">Agreement</Label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  <Input className="h-8 text-xs" placeholder="% e.g. 14"
                    value={form.agreementPct} onChange={e => update('agreementPct', e.target.value)} />
                  <Input className="h-8 text-xs" placeholder="Months e.g. 5"
                    value={form.agreementMonths} onChange={e => update('agreementMonths', e.target.value)} />
                  <Input className="h-8 text-xs" placeholder="Upfront $"
                    value={form.upfrontAmount} onChange={e => update('upfrontAmount', e.target.value)} />
                </div>
              </div>

              <div>
                <Label className="text-xs">PO Count (branch-wise)</Label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {(['total', 'ggr', 'lkn', 'ahm', 'lko', 'uk'] as (keyof POCount)[]).map(k => (
                    <div key={k}>
                      <div className="text-[9px] uppercase text-muted-foreground mb-0.5">{k}</div>
                      <Input className="h-7 text-xs" placeholder="0"
                        value={form.poCount[k]} onChange={e => updateCount(k, e.target.value)} />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs">Interview Support Expert</Label>
                <Input className="h-8 text-xs mt-1" placeholder="Expert name"
                  value={form.interviewExpert} onChange={e => update('interviewExpert', e.target.value)} />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t px-5 py-3 flex gap-2 shrink-0">
          <Button size="sm" className="text-xs flex-1" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : '💾 Save Draft'}
          </Button>
          <Button variant="outline" size="sm" className="text-xs flex-1"
            onClick={handleGenerateDraft} disabled={generatingDraft || saving}>
            {generatingDraft ? 'Creating…' : '✉️ Generate Outlook Draft'}
          </Button>
          <Button variant="ghost" size="sm" className="text-xs" onClick={handleClose}>
            Cancel
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**
```bash
cd frontend && npx tsc --noEmit 2>&1 | grep PODraftSheet
```
Expected: no errors.

- [ ] **Step 3: Commit**
```bash
git add frontend/src/components/shared/PODraftSheet.tsx
git commit -m "feat: add PODraftSheet with auto-fill, save draft, and Outlook draft generation"
```

---

## Task 7: Wire TaskSheet into ExpertAnalytics + RecruiterAnalytics

**Files:**
- Modify: `frontend/src/components/dashboard/v2/ExpertAnalytics.tsx`
- Modify: `frontend/src/components/dashboard/v2/RecruiterAnalytics.tsx`

- [ ] **Step 1: Update ExpertAnalytics**

In `frontend/src/components/dashboard/v2/ExpertAnalytics.tsx`:

Replace the `TaskDetailDrawer` import:
```tsx
// REMOVE:
import { TaskDetailDrawer } from '@/components/shared/TaskDetailDrawer';

// ADD:
import { TaskSheet } from '@/components/shared/TaskSheet';
import { PODraftSheet } from '@/components/shared/PODraftSheet';
import type { TaskSheetPrefill } from '@/components/shared/TaskSheet';
```

Add `poPrefill` state alongside `selectedTaskId`:
```tsx
const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
const [poPrefill, setPoPrefill] = useState<TaskSheetPrefill | null>(null);
const [poSheetOpen, setPoSheetOpen] = useState(false);
```

At the bottom of the return, replace the `<TaskDetailDrawer>` with:
```tsx
<TaskSheet
  taskId={selectedTaskId}
  onClose={() => setSelectedTaskId(null)}
  onCreatePO={(prefill) => {
    setPoPrefill(prefill);
    setPoSheetOpen(true);
  }}
/>
<PODraftSheet
  open={poSheetOpen}
  onClose={() => { setPoSheetOpen(false); setPoPrefill(null); }}
  prefill={poPrefill}
/>
```

- [ ] **Step 2: Update RecruiterAnalytics**

Apply the exact same changes to `frontend/src/components/dashboard/v2/RecruiterAnalytics.tsx` — replace `TaskDetailDrawer` import, add the same three state variables, replace `<TaskDetailDrawer>` at the bottom with `<TaskSheet>` + `<PODraftSheet>`.

- [ ] **Step 3: Verify in browser**

Log in, go to `/dashboard-v2` → Expert Stats tab → click a row in the drilldown → sheet slides in from right with task details. Click "Create PO Draft" → PO form sheet opens stacked on top.

- [ ] **Step 4: Commit**
```bash
git add frontend/src/components/dashboard/v2/ExpertAnalytics.tsx \
        frontend/src/components/dashboard/v2/RecruiterAnalytics.tsx
git commit -m "feat: replace TaskDetailDrawer with TaskSheet in ExpertAnalytics and RecruiterAnalytics"
```

---

## Task 8: Wire TaskSheet into CandidateDetailPage + Create PO Action

**Files:**
- Modify: `frontend/src/pages/CandidateDetailPage.tsx`

- [ ] **Step 1: Add imports at top**

In `frontend/src/pages/CandidateDetailPage.tsx`, add imports:
```tsx
import { TaskSheet } from '@/components/shared/TaskSheet';
import { PODraftSheet } from '@/components/shared/PODraftSheet';
import type { TaskSheetPrefill } from '@/components/shared/TaskSheet';
```

- [ ] **Step 2: Add state variables**

Inside the component function, add alongside existing state:
```tsx
const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
const [poPrefill, setPoPrefill] = useState<TaskSheetPrefill | null>(null);
const [poSheetOpen, setPoSheetOpen] = useState(false);
```

- [ ] **Step 3: Make interview TaskCards clickable**

Find where `TaskCard` (or interview timeline items) renders a task. Add an `onClick` prop that sets `selectedTaskId` to `task._id` (or `task.taskId`). The exact variable name depends on the shape of items in the timeline — look for the `kind: 'interview'` branch and the task object's id field. Set:
```tsx
onClick={() => task._id && setSelectedTaskId(task._id)}
// and add cursor-pointer to the card className
```

- [ ] **Step 4: Add "Create PO" button to candidate actions**

Find the candidate header/actions area (near the "View Profile" or status badge area). Add a button visible when `candidate.status === 'Placement Offer'`:
```tsx
{candidate.status === 'Placement Offer' && (
  <Button
    variant="outline"
    size="sm"
    className="text-xs gap-1.5"
    onClick={() => {
      setPoPrefill({
        taskId: '',
        candidateId: candidate._id,
        candidateName: candidate['Candidate Name'],
        emailId: candidate['Email ID'],
        endClient: candidate['End Client'],
        position: candidate['Technology'] || '',
        vendor: candidate['Vendor'] || '',
        recruiter: candidate['Recruiter'] || '',
      });
      setPoSheetOpen(true);
    }}
  >
    ＋ Create PO Draft
  </Button>
)}
```

- [ ] **Step 5: Add sheets to JSX return**

Before the closing `</DashboardLayout>` tag, add:
```tsx
<TaskSheet
  taskId={selectedTaskId}
  onClose={() => setSelectedTaskId(null)}
  onCreatePO={(prefill) => {
    setPoPrefill(prefill);
    setPoSheetOpen(true);
  }}
/>
<PODraftSheet
  open={poSheetOpen}
  onClose={() => { setPoSheetOpen(false); setPoPrefill(null); }}
  prefill={poPrefill}
/>
```

- [ ] **Step 6: Verify TypeScript**
```bash
cd frontend && npx tsc --noEmit 2>&1 | grep CandidateDetailPage
```
Expected: no errors.

- [ ] **Step 7: Commit**
```bash
git add frontend/src/pages/CandidateDetailPage.tsx
git commit -m "feat: add TaskSheet and Create PO action to CandidateDetailPage"
```

---

## Task 9: Wire TaskSheet into TasksToday

**Files:**
- Modify: `frontend/src/pages/TasksToday.tsx`

> Note: This file is ~4800 lines. Make minimal, targeted changes only.

- [ ] **Step 1: Add imports (top of file)**

In `frontend/src/pages/TasksToday.tsx`, add after the existing imports:
```tsx
import { TaskSheet } from '@/components/shared/TaskSheet';
import { PODraftSheet } from '@/components/shared/PODraftSheet';
import type { TaskSheetPrefill } from '@/components/shared/TaskSheet';
```

- [ ] **Step 2: Add state (inside component function, after existing state declarations)**

Find the block of `useState` declarations (around line 550–600). Add:
```tsx
const [sheetTaskId, setSheetTaskId] = useState<string | null>(null);
const [poPrefill, setPoPrefill] = useState<TaskSheetPrefill | null>(null);
const [poSheetOpen, setPoSheetOpen] = useState(false);
```

- [ ] **Step 3: Make table row clickable**

Find the `<TableRow key={task._id} className={getRowClasses(task.status)}>` line (around line 4055). Add `onClick` and `cursor-pointer`:
```tsx
<TableRow
  key={task._id}
  className={`${getRowClasses(task.status)} cursor-pointer`}
  onClick={() => task._id && setSheetTaskId(task._id)}
>
```

- [ ] **Step 4: Add sheets before closing tag**

Find the last `</DashboardLayout>` in the return. Just before it add:
```tsx
<TaskSheet
  taskId={sheetTaskId}
  onClose={() => setSheetTaskId(null)}
  onCreatePO={(prefill) => {
    setPoPrefill(prefill);
    setPoSheetOpen(true);
  }}
/>
<PODraftSheet
  open={poSheetOpen}
  onClose={() => { setPoSheetOpen(false); setPoPrefill(null); }}
  prefill={poPrefill}
/>
```

- [ ] **Step 5: Verify TypeScript**
```bash
cd frontend && npx tsc --noEmit 2>&1 | grep TasksToday
```
Expected: no errors.

- [ ] **Step 6: Test in browser**

Go to `/tasks`. Click any task row. Sheet slides in from the right showing task details + email thread.

- [ ] **Step 7: Commit**
```bash
git add frontend/src/pages/TasksToday.tsx
git commit -m "feat: add TaskSheet on task row click in TasksToday"
```

---

## Task 10: Build + Deploy Frontend

- [ ] **Step 1: Build**
```bash
cd frontend && npm run build
```
Expected: build completes with no TypeScript errors. Output in `frontend/dist/`.

- [ ] **Step 2: Deploy to Docker**
```bash
docker cp frontend/dist/. dailydb-frontend-blue:/usr/share/nginx/html/
docker restart dailydb-frontend-blue
```

- [ ] **Step 3: End-to-end smoke test**

1. `/profile-hub` → click Recruiters tab → URL shows `?tab=recruiters` → press Back → returns to Overview
2. `/dashboard-v2` → click Expert Stats → URL shows `?tab=expert` → press Back → returns to Overview  
3. Expert drilldown → click a task row → TaskSheet slides in → shows email thread
4. TaskSheet footer → "Create PO Draft" → PODraftSheet opens stacked → fill rate + dates → "Save Draft" → toast appears
5. PODraftSheet → "Generate Outlook Draft" → toast with "Open in Outlook" link
6. `/candidate/:id` with Placement Offer status → "Create PO Draft" button visible in header

- [ ] **Step 4: Final commit**
```bash
git add -A
git commit -m "feat: deploy task sheet, PO draft, and tab nav fix"
```
