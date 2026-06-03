# SP2 — Meeting Started toggle + Technical-Team Acknowledgment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-way, record-only "Meeting Started" toggle to each task, plus a one-time versioned acknowledgment that instructs the technical team to use it.

**Architecture:** Part A mirrors the existing task-meeting controller (`updateMeetingLink` — in-controller `database.getCollection('taskBody')` write, returns the updated state) and adds a `PATCH /api/tasks/:taskId/meeting-started`; the new fields flow to the UI automatically because the task list aggregation uses `$unset` (blacklist), not a projection. Part B mirrors the `/me/preferences` precedent (`userController` + `routes/users.js` + `userModel.updateUser` dot-notation) for a versioned `GET`/`PATCH /api/users/me/technical-acknowledgment`, surfaced by a modal mounted in `DashboardLayout` next to the existing consent dialog.

**Tech Stack:** Node ESM + Express 5 + raw MongoDB driver + Jest (backend); Vite + React 18 + TS + shadcn/ui + Vitest (frontend).

**Branch:** `feat/sp2-technical-ack` (already created off latest main).

**Spec:** `docs/superpowers/specs/2026-06-03-sp2-technical-ack-design.md`

---

## File Structure

**Backend**
- `backend/src/controllers/taskController.js` — add `markMeetingStarted` (mirror `updateMeetingLink`).
- `backend/src/routes/tasks.js` — add `PATCH /:taskId/meeting-started`.
- `backend/src/config/technicalAck.js` *(new)* — `TECHNICAL_ACK` constant + `TECHNICAL_ACK_ROLES`.
- `backend/src/controllers/userController.js` — add `getMyTechnicalAck` / `updateMyTechnicalAck` (mirror `getMyPreferences` / `updateMyPreferences`).
- `backend/src/routes/users.js` — add the two `/me/technical-acknowledgment` routes next to `/me/preferences`.
- Tests: `backend/test/taskController.markMeetingStarted.test.js`, `backend/test/userController.technicalAck.test.js`.

**Frontend**
- `frontend/src/pages/TasksToday.tsx` — `Task` type fields + `canMarkStarted` + `handleMarkStarted` + the toggle UI in the meetings cell.
- `frontend/src/components/TechnicalAckModal.tsx` *(new)*.
- `frontend/src/components/layout/DashboardLayout.tsx` — mount `<TechnicalAckModal />`.
- Test: `frontend/src/components/__tests__/TechnicalAckModal.test.tsx` *(new)*.

## Conventions (read once)

- **Backend tests via Bash** (the `npm test` script's `NODE_ENV=test` prefix fails through cmd): `cd backend && export NODE_ENV=test && export NODE_OPTIONS=--experimental-vm-modules && npx jest <file>`.
- **Frontend:** `cd frontend && npx tsc --noEmit` and `npx vitest run <file>`.
- `req.user.role` is the **legacy token** (post-`authenticateHTTP`). Technical roles = `user` (expert), `am`, `lead`.
- **Commits:** plain subject + optional body. **No AI-attribution trailers** (hard repo rule).

---

## Task 1: `markMeetingStarted` controller + route (backend)

**Files:**
- Modify: `backend/src/controllers/taskController.js` (add a method after `ensureMeeting`)
- Modify: `backend/src/routes/tasks.js` (add a route next to `meeting-link`/`ensure-meeting`)
- Test: `backend/test/taskController.markMeetingStarted.test.js`

`database` and `ObjectId` are already imported in `taskController.js` (used by `updateMeetingLink`).

- [ ] **Step 1: Write the failing test**

Create `backend/test/taskController.markMeetingStarted.test.js`:

```js
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();
const mockGetCollection = jest.fn(() => ({ findOne: mockFindOne, updateOne: mockUpdateOne }));
jest.unstable_mockModule('../src/config/database.js', () => ({ database: { getCollection: mockGetCollection } }));
jest.unstable_mockModule('../src/services/meetingProvisioningService.js', () => ({ ensureMeetingForTask: jest.fn(), buildEventPayload: jest.fn() }));
jest.unstable_mockModule('../src/middleware/errorHandler.js', () => ({ asyncHandler: (fn) => fn }));
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.unstable_mockModule('../src/services/taskService.js', () => ({ taskService: {} }));
jest.unstable_mockModule('../src/services/thanksMailService.js', () => ({ thanksMailService: {} }));
jest.unstable_mockModule('../src/services/interviewerQuestionService.js', () => ({ interviewerQuestionService: {} }));
jest.unstable_mockModule('../src/services/interviewDebriefService.js', () => ({ interviewDebriefService: {} }));

const { taskController } = await import('../src/controllers/taskController.js');

const VALID_ID = '507f1f77bcf86cd799439011';
function res() { const r = { statusCode: 200, body: undefined }; r.status = jest.fn((c) => { r.statusCode = c; return r; }); r.json = jest.fn((p) => { r.body = p; return r; }); return r; }
const req = (over = {}) => ({ params: { taskId: VALID_ID }, user: { email: 'exp@x.com', role: 'user' }, body: {}, ...over });

beforeEach(() => { jest.clearAllMocks(); mockUpdateOne.mockResolvedValue({ matchedCount: 1 }); });

describe('taskController.markMeetingStarted', () => {
  it('400 on invalid taskId', async () => {
    const r = res();
    await taskController.markMeetingStarted(req({ params: { taskId: 'nope' } }), r);
    expect(r.statusCode).toBe(400);
  });

  it('404 when task missing', async () => {
    mockFindOne.mockResolvedValue(null);
    const r = res();
    await taskController.markMeetingStarted(req(), r);
    expect(r.statusCode).toBe(404);
  });

  it('assigned expert marks own task started', async () => {
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'exp@x.com' });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'exp@x.com', role: 'user' } }), r);
    expect(r.body).toMatchObject({ success: true, meetingStarted: true, meetingStartedBy: 'exp@x.com' });
    expect(mockUpdateOne).toHaveBeenCalled();
  });

  it('non-assigned expert is 403', async () => {
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'other@x.com' });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'exp@x.com', role: 'user' } }), r);
    expect(r.statusCode).toBe(403);
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it('am / lead / admin can mark any task', async () => {
    for (const role of ['am', 'lead', 'admin']) {
      jest.clearAllMocks();
      mockUpdateOne.mockResolvedValue({ matchedCount: 1 });
      mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'other@x.com' });
      const r = res();
      await taskController.markMeetingStarted(req({ user: { email: 'mgr@x.com', role } }), r);
      expect(r.body.success).toBe(true);
      expect(mockUpdateOne).toHaveBeenCalled();
    }
  });

  it('marketing role is 403', async () => {
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'exp@x.com' });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'rec@x.com', role: 'recruiter' } }), r);
    expect(r.statusCode).toBe(403);
  });

  it('idempotent: already started returns existing without updating', async () => {
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'exp@x.com', meetingStarted: true, meetingStartedAt: 'T0', meetingStartedBy: 'exp@x.com' });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'exp@x.com', role: 'user' } }), r);
    expect(r.body).toMatchObject({ meetingStarted: true, meetingStartedAt: 'T0', meetingStartedBy: 'exp@x.com' });
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && export NODE_ENV=test && export NODE_OPTIONS=--experimental-vm-modules && npx jest taskController.markMeetingStarted.test.js`
Expected: FAIL — `taskController.markMeetingStarted is not a function`.

- [ ] **Step 3: Implement the controller method**

In `backend/src/controllers/taskController.js`, add this method immediately after `ensureMeeting` (it mirrors `updateMeetingLink`'s in-controller `database.getCollection('taskBody')` pattern):

```js
  // SP2 — one-way, record-only "Meeting Started" toggle. Gate: the assigned
  // expert (assignedTo) may mark their own; am/lead/admin may mark any.
  // Idempotent: once started it stays set (admin corrects out-of-band).
  markMeetingStarted = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    if (!ObjectId.isValid(taskId)) {
      return res.status(400).json({ success: false, error: 'Invalid taskId' });
    }

    const collection = database.getCollection('taskBody');
    const task = await collection.findOne({ _id: new ObjectId(taskId) });
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const actorEmail = (req.user?.email || '').trim().toLowerCase();
    const actorRole = (req.user?.role || '').trim().toLowerCase();
    const assignedRaw = task.assignedTo || task.AssignedExpert || task.assignedExpert || '';
    const assignedEmail = String(assignedRaw).includes('@') ? String(assignedRaw).trim().toLowerCase() : '';
    const allowed = actorRole === 'admin'
      || actorRole === 'am'
      || actorRole === 'lead'
      || (actorRole === 'user' && assignedEmail && actorEmail === assignedEmail);
    if (!allowed) {
      return res.status(403).json({ success: false, error: 'Not allowed to mark this meeting started' });
    }

    if (task.meetingStarted === true) {
      return res.json({
        success: true,
        meetingStarted: true,
        meetingStartedAt: task.meetingStartedAt || null,
        meetingStartedBy: task.meetingStartedBy || null,
      });
    }

    const meetingStartedAt = new Date().toISOString();
    await collection.updateOne(
      { _id: new ObjectId(taskId) },
      { $set: { meetingStarted: true, meetingStartedAt, meetingStartedBy: actorEmail } }
    );
    return res.json({ success: true, meetingStarted: true, meetingStartedAt, meetingStartedBy: actorEmail });
  });
```

- [ ] **Step 4: Add the route**

In `backend/src/routes/tasks.js`, after the `meeting-link` / `ensure-meeting` routes (~line 21):

```js
router.patch('/:taskId/meeting-started', taskController.markMeetingStarted);
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && export NODE_ENV=test && export NODE_OPTIONS=--experimental-vm-modules && npx jest taskController.markMeetingStarted.test.js`
Expected: PASS (all 7).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/taskController.js backend/src/routes/tasks.js backend/test/taskController.markMeetingStarted.test.js
git commit -m "feat(tasks): PATCH /:taskId/meeting-started one-way Meeting Started toggle"
```

---

## Task 2: Meeting Started toggle UI (frontend)

**Files:**
- Modify: `frontend/src/pages/TasksToday.tsx`

- [ ] **Step 1: Extend the `Task` type**

In the `Task` interface (near line 81, by `meetingLink?`), add:

```ts
  meetingStarted?: boolean;
  meetingStartedAt?: string | null;
  meetingStartedBy?: string | null;
```

- [ ] **Step 2: Add the permission flag**

Near the other `normalizedRole` memos (~line 458–472), add:

```ts
  const canMarkStarted = useMemo(
    () => ['admin', 'user', 'am', 'lead'].includes(normalizedRole),
    [normalizedRole]
  );
```

- [ ] **Step 3: Add the handler**

Near `handleCreateMeeting`, add (uses the existing `authFetch` + `API_URL`, and `toast`/`setTasks` the file already uses — match the exact state-updater name used by `handleCreateMeeting`, which updates the task list item in place):

```ts
  const handleMarkStarted = useCallback(async (task: Task) => {
    try {
      const res = await authFetch(`${API_URL}/api/tasks/${task._id}/meeting-started`, { method: 'PATCH' });
      const data = await parseJsonOrThrow<{ success: boolean; meetingStarted: boolean; meetingStartedAt: string | null; meetingStartedBy: string | null }>(res);
      setTasks((prev) => prev.map((item) =>
        item._id === task._id
          ? { ...item, meetingStarted: data.meetingStarted, meetingStartedAt: data.meetingStartedAt, meetingStartedBy: data.meetingStartedBy }
          : item
      ));
    } catch (e) {
      toast({ title: 'Could not mark started', description: e instanceof Error ? e.message : 'Try again', variant: 'destructive' });
    }
  }, [authFetch]);
```

> The list setter is `setTasks` (declared at line 365; `handleCreateMeeting` updates a row the same way at ~line 2872). `parseJsonOrThrow` is imported from `@/lib/fetchJson` (add the import if not already present). `toast` comes from `useToast()` (already used in this file at line 477).

- [ ] **Step 4: Render the toggle in the meetings cell**

Inside the `{meetingsEnabled && (<TableCell> … </TableCell>)}` block (~line 4235–4272), after the Join/Create-meeting block, add a Meeting Started control:

```tsx
                        <div className="mt-1">
                          {task.meetingStarted ? (
                            <Badge
                              variant="secondary"
                              title={task.meetingStartedBy ? `Started by ${task.meetingStartedBy}${task.meetingStartedAt ? ` at ${task.meetingStartedAt}` : ''}` : 'Started'}
                            >
                              Started ✓
                            </Badge>
                          ) : canMarkStarted ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => { void handleMarkStarted(task); }}
                            >
                              Mark started
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not started</span>
                          )}
                        </div>
```

(`Badge` and `Button` are already imported in this file.)

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Manual smoke (document)**

As an expert on your own task: "Mark started" shows → click → it becomes "Started ✓"; reload keeps it started. As a marketing user: no "Mark started" (sees "Not started" or, if `meetingsEnabled` is false for them, nothing).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/TasksToday.tsx
git commit -m "feat(tasks): Meeting Started toggle on the TasksToday row"
```

---

## Task 3: Acknowledgment constant + endpoints (backend)

**Files:**
- Create: `backend/src/config/technicalAck.js`
- Modify: `backend/src/controllers/userController.js` (add two methods next to `getMyPreferences`/`updateMyPreferences`)
- Modify: `backend/src/routes/users.js` (two routes next to `/me/preferences`)
- Test: `backend/test/userController.technicalAck.test.js`

- [ ] **Step 1: Create the constant**

Create `backend/src/config/technicalAck.js`:

```js
// SP2 — the one-time technical-team acknowledgment. Bump `version` to
// re-prompt the whole technical team after editing the wording.
export const TECHNICAL_ACK = {
  version: 1,
  title: 'Technical Team — Before You Start Meetings',
  sections: [
    'You must toggle the "Meeting Started" button before starting each meeting.',
    'This is mandatory — a meeting will not be considered started unless you toggle it.',
  ],
};

// Legacy role tokens that must acknowledge (req.user.role is already legacy).
export const TECHNICAL_ACK_ROLES = ['user', 'am', 'lead'];
```

- [ ] **Step 2: Write the failing test**

Create `backend/test/userController.technicalAck.test.js`:

```js
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockGetUserByEmail = jest.fn();
const mockUpdateUser = jest.fn();
jest.unstable_mockModule('../src/models/User.js', () => ({ userModel: { getUserByEmail: mockGetUserByEmail, updateUser: mockUpdateUser } }));
jest.unstable_mockModule('../src/middleware/errorHandler.js', () => ({ asyncHandler: (fn) => fn }));
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const { userController } = await import('../src/controllers/userController.js');
const { TECHNICAL_ACK } = await import('../src/config/technicalAck.js');

function res() { const r = { statusCode: 200, body: undefined }; r.status = jest.fn((c) => { r.statusCode = c; return r; }); r.json = jest.fn((p) => { r.body = p; return r; }); return r; }
beforeEach(() => jest.clearAllMocks());

describe('userController.getMyTechnicalAck', () => {
  it('technical role + never agreed → required with content', async () => {
    mockGetUserByEmail.mockReturnValue({ email: 'e@x.com' });
    const r = res();
    await userController.getMyTechnicalAck({ user: { email: 'e@x.com', role: 'user' } }, r);
    expect(r.body.required).toBe(true);
    expect(r.body.content.version).toBe(TECHNICAL_ACK.version);
  });

  it('technical role + agreed current → not required, no content', async () => {
    mockGetUserByEmail.mockReturnValue({ email: 'e@x.com', technicalAck: { version: TECHNICAL_ACK.version } });
    const r = res();
    await userController.getMyTechnicalAck({ user: { email: 'e@x.com', role: 'am' } }, r);
    expect(r.body.required).toBe(false);
    expect(r.body.content).toBeNull();
  });

  it('non-technical role → never required', async () => {
    const r = res();
    await userController.getMyTechnicalAck({ user: { email: 'm@x.com', role: 'recruiter' } }, r);
    expect(r.body.required).toBe(false);
  });
});

describe('userController.updateMyTechnicalAck', () => {
  it('valid version records and returns required:false', async () => {
    mockUpdateUser.mockResolvedValue({});
    const r = res();
    await userController.updateMyTechnicalAck({ user: { email: 'e@x.com', role: 'user' }, body: { version: TECHNICAL_ACK.version } }, r);
    expect(r.body).toMatchObject({ success: true, required: false, agreedVersion: TECHNICAL_ACK.version });
    expect(mockUpdateUser).toHaveBeenCalledWith('e@x.com', expect.objectContaining({ 'technicalAck.version': TECHNICAL_ACK.version, _source: 'self-technical-ack' }));
  });

  it('missing/stale version → 400, no write', async () => {
    const r = res();
    await userController.updateMyTechnicalAck({ user: { email: 'e@x.com', role: 'user' }, body: { version: 999 } }, r);
    expect(r.statusCode).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});
```

> If importing `userController.js` fails because of other import-time deps, mirror the module-mock set from the existing `userController` preferences test in `backend/test/` (whichever file tests `getMyPreferences`/`updateMyPreferences`) and layer the `userModel`/`logger` mocks above on top. Assertions stay as written.

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && export NODE_ENV=test && export NODE_OPTIONS=--experimental-vm-modules && npx jest userController.technicalAck.test.js`
Expected: FAIL — `userController.getMyTechnicalAck is not a function`.

- [ ] **Step 4: Implement the controller methods**

In `backend/src/controllers/userController.js`: add the import near the top (with the other imports):

```js
import { TECHNICAL_ACK, TECHNICAL_ACK_ROLES } from '../config/technicalAck.js';
```

Add these two methods right after `updateMyPreferences` (they mirror its shape):

```js
  // SP2 — one-time, versioned technical-team acknowledgment status.
  getMyTechnicalAck = asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user?.email) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const role = (user.role || '').trim().toLowerCase();
    const currentVersion = TECHNICAL_ACK.version;
    if (!TECHNICAL_ACK_ROLES.includes(role)) {
      return res.json({ success: true, required: false, currentVersion, agreedVersion: 0, content: null });
    }
    try {
      const record = userModel.getUserByEmail(user.email) || {};
      const agreedVersion = Number(record.technicalAck?.version) || 0;
      const required = agreedVersion !== currentVersion;
      return res.json({
        success: true,
        required,
        currentVersion,
        agreedVersion,
        content: required
          ? { version: currentVersion, title: TECHNICAL_ACK.title, sections: TECHNICAL_ACK.sections }
          : null,
      });
    } catch (error) {
      logger.error('getMyTechnicalAck failed', { error: error.message, email: user.email });
      return res.status(500).json({ success: false, error: 'Unable to read acknowledgment status' });
    }
  });

  // SP2 — record agreement to the current version.
  updateMyTechnicalAck = asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user?.email) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const currentVersion = TECHNICAL_ACK.version;
    const version = Number(req.body?.version);
    if (!version || version !== currentVersion) {
      return res.status(400).json({ success: false, error: `version must equal the current version (${currentVersion})` });
    }
    try {
      const agreedAt = new Date().toISOString();
      await userModel.updateUser(user.email, {
        'technicalAck.version': currentVersion,
        'technicalAck.agreedAt': agreedAt,
        _changedBy: user.email,
        _source: 'self-technical-ack',
      });
      return res.json({ success: true, required: false, currentVersion, agreedVersion: currentVersion });
    } catch (error) {
      logger.error('updateMyTechnicalAck failed', { error: error.message, email: user.email });
      return res.status(500).json({ success: false, error: 'Unable to record acknowledgment' });
    }
  });
```

- [ ] **Step 5: Add the routes**

In `backend/src/routes/users.js`, after the `/me/preferences` routes (~line 17):

```js
router.get('/me/technical-acknowledgment', userController.getMyTechnicalAck);
router.patch('/me/technical-acknowledgment', userController.updateMyTechnicalAck);
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && export NODE_ENV=test && export NODE_OPTIONS=--experimental-vm-modules && npx jest userController.technicalAck.test.js`
Expected: PASS (all 5).

- [ ] **Step 7: Commit**

```bash
git add backend/src/config/technicalAck.js backend/src/controllers/userController.js backend/src/routes/users.js backend/test/userController.technicalAck.test.js
git commit -m "feat(tech-ack): versioned technical-team acknowledgment GET/PATCH endpoints"
```

---

## Task 4: `TechnicalAckModal` + mount (frontend)

**Files:**
- Create: `frontend/src/components/TechnicalAckModal.tsx`
- Modify: `frontend/src/components/layout/DashboardLayout.tsx`
- Test: `frontend/src/components/__tests__/TechnicalAckModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/__tests__/TechnicalAckModal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const authFetch = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ authFetch }), API_URL: '' }));
const parseJsonOrThrow = vi.fn();
vi.mock('@/lib/fetchJson', () => ({ parseJsonOrThrow: (...a: unknown[]) => parseJsonOrThrow(...a) }));

import { TechnicalAckModal } from '../TechnicalAckModal';

beforeEach(() => { vi.clearAllMocks(); authFetch.mockResolvedValue({}); });

describe('TechnicalAckModal', () => {
  it('does not render the dialog when not required', async () => {
    parseJsonOrThrow.mockResolvedValueOnce({ required: false, content: null });
    render(<TechnicalAckModal />);
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(screen.queryByText(/Before You Start Meetings/i)).toBeNull();
  });

  it('renders when required; Submit disabled until checkbox; PATCH on submit', async () => {
    parseJsonOrThrow
      .mockResolvedValueOnce({ required: true, content: { version: 1, title: 'Technical Team — Before You Start Meetings', sections: ['A', 'B'] } })
      .mockResolvedValueOnce({ success: true });
    render(<TechnicalAckModal />);
    const submit = await screen.findByRole('button', { name: /agree & submit/i });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(authFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/users/me/technical-acknowledgment'),
        expect.objectContaining({ method: 'PATCH' })
      )
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/TechnicalAckModal.test.tsx`
Expected: FAIL — cannot find module `../TechnicalAckModal`.

- [ ] **Step 3: Implement the modal**

Create `frontend/src/components/TechnicalAckModal.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { parseJsonOrThrow } from '@/lib/fetchJson';

interface AckContent { version: number; title: string; sections: string[]; }
interface AckStatus { required: boolean; currentVersion: number; agreedVersion: number; content: AckContent | null; }

export function TechnicalAckModal() {
  const { authFetch } = useAuth();
  const [content, setContent] = useState<AckContent | null>(null);
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${API_URL}/api/users/me/technical-acknowledgment`);
        const data = await parseJsonOrThrow<AckStatus>(res);
        if (!cancelled && data.required && data.content) {
          setContent(data.content);
          setOpen(true);
        }
      } catch {
        // Non-blocking: if the status check fails, don't surface the modal.
      }
    })();
    return () => { cancelled = true; };
  }, [authFetch]);

  const submit = async () => {
    if (!content || !agreed) return;
    setSubmitting(true);
    try {
      const res = await authFetch(`${API_URL}/api/users/me/technical-acknowledgment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: content.version }),
      });
      await parseJsonOrThrow(res);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!content) return null;

  return (
    // onOpenChange is a no-op + outside/escape are prevented, so the ONLY way
    // to dismiss is to agree + submit. If not agreed, it re-shows next load.
    <Dialog open={open} onOpenChange={() => { /* agree-only dismissal */ }}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>{content.title}</DialogTitle></DialogHeader>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          {content.sections.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
        <label className="flex items-center gap-2 text-sm mt-2">
          <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(Boolean(v))} />
          I have read and agree
        </label>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!agreed || submitting}>
            {submitting ? 'Submitting…' : 'I agree & Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

> If `@/components/ui/checkbox` doesn't exist in this repo's shadcn set, use a native `<input type="checkbox">` with the same `checked`/`onChange` wiring (the test queries `getByRole('checkbox')`, which matches both).

- [ ] **Step 4: Mount it in `DashboardLayout`**

In `frontend/src/components/layout/DashboardLayout.tsx`, add the import near the `MicrosoftConsentDialog` import (~line 6):

```tsx
import { TechnicalAckModal } from '@/components/TechnicalAckModal';
```

and render it next to `<MicrosoftConsentDialog />` (~line 84):

```tsx
          <MicrosoftConsentDialog />
          <TechnicalAckModal />
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run src/components/__tests__/TechnicalAckModal.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 6: Type-check + commit**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/components/TechnicalAckModal.tsx frontend/src/components/layout/DashboardLayout.tsx frontend/src/components/__tests__/TechnicalAckModal.test.tsx
git commit -m "feat(tech-ack): one-time technical-team acknowledgment modal in the app shell"
```

---

## Task 5: Full verification + PR

- [ ] **Step 1: Backend tests**

Run: `cd backend && export NODE_ENV=test && export NODE_OPTIONS=--experimental-vm-modules && npx jest taskController.markMeetingStarted.test.js userController.technicalAck.test.js`
Expected: all PASS.

- [ ] **Step 2: Frontend checks**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/components/__tests__/TechnicalAckModal.test.tsx`
Expected: PASS. Optionally `npm run build`.

- [ ] **Step 3: Push + PR**

```bash
git push -u origin feat/sp2-technical-ack
gh pr create --base main --title "feat(tech-ack): SP2 — Meeting Started toggle + one-time technical-team acknowledgment" --body "<summary; NO AI-attribution trailer>"
```

PR body: the one-way record-only Meeting Started toggle (`PATCH /api/tasks/:taskId/meeting-started`, assigned-expert/`am`/`lead`/`admin` gate, TasksToday UI) + the versioned one-time acknowledgment (`GET`/`PATCH /api/users/me/technical-acknowledgment`, technical roles, app-shell modal). Note the v1 acknowledgment wording is the "Meeting Started" instruction; bump `TECHNICAL_ACK.version` to re-prompt.

- [ ] **Step 4: Wait for CI; fix failures; report PR URL.**

---

## Out of scope
- Meeting-started gating/analytics/status change; un-toggle from the UI; acknowledgment email; admin UI to edit the text; acknowledgment history log. (See spec §9.)
