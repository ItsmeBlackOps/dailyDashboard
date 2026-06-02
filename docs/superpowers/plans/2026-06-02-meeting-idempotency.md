# Server-side Idempotent Meeting Creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "one Teams meeting per task" a hard guarantee by moving creation to a single idempotent, atomically-gated backend endpoint.

**Architecture:** A new `POST /api/tasks/:taskId/ensure-meeting` endpoint runs OBO server-side. It short-circuits if the task already has a link, otherwise wins an atomic per-task DB claim, creates the calendar event (`/me/events`, `isOnlineMeeting:true`) via OBO, sets lobby bypass, persists the link, and clears the claim. Concurrency and reloads can never produce a second meeting. The TasksToday client (auto-create effect + manual button) calls this endpoint instead of talking to Graph directly.

**Tech Stack:** Node ESM, Express 5, MongoDB raw driver, `@azure/msal-node` (OBO), `moment-timezone`, Microsoft Graph; React 18 + TS + MSAL on the client. Jest (ESM) + Vitest/tsc for tests.

**Spec:** `docs/superpowers/specs/2026-06-02-meeting-idempotency-design.md`

---

## File structure

- **Create** `backend/src/services/meetingProvisioningService.js` — owns the whole "ensure one meeting for a task" flow: short-circuit, atomic claim, event-payload build, Graph create (delegates to `graphMeetingService`), lobby bypass, persist, release. Single responsibility, unit-testable with `database` + `graphMeetingService` mocked.
- **Modify** `backend/src/services/graphMeetingService.js` — add `createEventMeeting(userAssertion, eventPayload)` (OBO → `POST /me/events`), mirroring the existing `createMeeting`.
- **Modify** `backend/src/controllers/taskController.js` — add thin `ensureMeeting` handler.
- **Modify** `backend/src/routes/tasks.js` — add the route.
- **Modify** `frontend/src/pages/TasksToday.tsx` — `handleCreateMeeting` calls the endpoint; remove the now-unused `createOutlookEvent`.
- **Create** `backend/test/meetingProvisioningService.test.js`, `backend/test/graphMeetingService.createEventMeeting.test.js`, `backend/test/taskController.ensureMeeting.test.js`.

**Constants** (define in `meetingProvisioningService.js`): `LOCK_TTL_MS = 3 * 60 * 1000`, `EVENT_TZ_IANA = 'America/New_York'`, `EVENT_TZ_WINDOWS = 'Eastern Standard Time'`, `FIREFLIES_ATTENDEE = { address: 'fred@fireflies.ai', name: 'Fred (Fireflies)' }`, `FIXED_ATTENDEE = { address: 'harsh.patel@silverspaceinc.com', name: 'Harsh Patel' }`.

---

## Task 1: `graphMeetingService.createEventMeeting`

Creates the calendar event (which spawns the single Teams meeting) via OBO and returns the parsed Graph response. Mirrors the existing `createMeeting` exactly, but targets `/me/events` instead of `/me/onlineMeetings`.

**Files:**
- Modify: `backend/src/services/graphMeetingService.js`
- Test: `backend/test/graphMeetingService.createEventMeeting.test.js`

- [ ] **Step 0: Verify the Graph payload via Context7 (CLAUDE.md mandate)**

Call `mcp__context7__resolve-library-id` for "Microsoft Graph" and `mcp__context7__query-docs` for "create event isOnlineMeeting teamsForBusiness onlineMeeting joinUrl". Confirm: `POST /v1.0/me/events` with `isOnlineMeeting:true` + `onlineMeetingProvider:'teamsForBusiness'` returns the created event including `onlineMeeting.joinUrl`. (This payload is already proven in the current client code — Context7 is the version-accurate cross-check.)

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/graphMeetingService.createEventMeeting.test.js
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { graphMeetingService } from '../src/services/graphMeetingService.js';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

describe('graphMeetingService.createEventMeeting', () => {
  it('OBO-exchanges the assertion, POSTs the event to /me/events, and returns the parsed body', async () => {
    jest.spyOn(graphMeetingService, 'acquireOnBehalfOfToken').mockResolvedValue('graph-token');
    const payload = { subject: 'Interview', isOnlineMeeting: true };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: 'evt1', onlineMeeting: { joinUrl: 'https://teams/x' } }),
    });

    const result = await graphMeetingService.createEventMeeting('assertion-token', payload);

    expect(graphMeetingService.acquireOnBehalfOfToken)
      .toHaveBeenCalledWith('assertion-token', graphMeetingService.scopes);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/events');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer graph-token');
    expect(JSON.parse(opts.body)).toEqual(payload);
    expect(result.onlineMeeting.joinUrl).toBe('https://teams/x');
  });

  it('throws on a non-OK Graph response', async () => {
    jest.spyOn(graphMeetingService, 'acquireOnBehalfOfToken').mockResolvedValue('graph-token');
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 403, text: async () => JSON.stringify({ error: 'denied' }),
    });
    await expect(graphMeetingService.createEventMeeting('a', {})).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest test/graphMeetingService.createEventMeeting.test.js`
Expected: FAIL — `graphMeetingService.createEventMeeting is not a function`.

- [ ] **Step 3: Implement `createEventMeeting`**

In `backend/src/services/graphMeetingService.js`, add a module constant near the top (below `const GRAPH_ENDPOINT = ...`):

```javascript
const GRAPH_EVENTS_ENDPOINT = 'https://graph.microsoft.com/v1.0/me/events';
```

Add this method to the class, immediately after `createMeeting` (mirror its structure exactly):

```javascript
  async createEventMeeting(userAssertion, eventPayload) {
    const accessToken = await this.acquireOnBehalfOfToken(userAssertion, this.scopes);

    const response = await fetch(GRAPH_EVENTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(eventPayload)
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (error) {
      logger.error('Failed to parse Graph event response', { error: error.message });
      parsed = text;
    }

    if (!response.ok) {
      throw new GraphRequestError('Microsoft Graph event request failed', response.status, parsed);
    }

    return parsed;
  }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest test/graphMeetingService.createEventMeeting.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/graphMeetingService.js backend/test/graphMeetingService.createEventMeeting.test.js
git commit -m "feat(meetings): add graphMeetingService.createEventMeeting (OBO /me/events)"
```

---

## Task 2: `meetingProvisioningService.buildEventPayload`

Pure function: given a task document, produce the Graph `/me/events` payload (or `null` if the interview times are invalid). Mirrors the client's `createOutlookEvent` payload and the server's `Task.formatTask` time parsing.

**Files:**
- Create: `backend/src/services/meetingProvisioningService.js`
- Test: `backend/test/meetingProvisioningService.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/meetingProvisioningService.test.js
import { describe, it, expect } from '@jest/globals';
import { buildEventPayload } from '../src/services/meetingProvisioningService.js';

const TASK = {
  subject: 'Interview Support - Sravani Komma - Business Analyst',
  'Candidate Name': 'Sravani Komma',
  'End Client': 'Vizva Inc.',
  'Interview Round': 'Technical',
  'Date of Interview': '06/02/2026',
  'Start Time Of Interview': '12:00 PM',
  'End Time Of Interview': '1:00 PM',
};

describe('buildEventPayload', () => {
  it('builds an online-meeting event with the fixed + Fireflies attendees and ET times', () => {
    const p = buildEventPayload(TASK);
    expect(p.subject).toBe(TASK.subject);
    expect(p.isOnlineMeeting).toBe(true);
    expect(p.onlineMeetingProvider).toBe('teamsForBusiness');
    expect(p.start).toEqual({ dateTime: '2026-06-02T12:00:00', timeZone: 'Eastern Standard Time' });
    expect(p.end).toEqual({ dateTime: '2026-06-02T13:00:00', timeZone: 'Eastern Standard Time' });
    const addresses = p.attendees.map((a) => a.emailAddress.address);
    expect(addresses).toEqual(expect.arrayContaining(['harsh.patel@silverspaceinc.com', 'fred@fireflies.ai']));
    expect(p.body.content).toContain('Sravani Komma');
    expect(p.body.content).toContain('Vizva Inc.');
  });

  it('falls back to a generated subject and returns null on invalid times', () => {
    const noSubject = buildEventPayload({ ...TASK, subject: undefined });
    expect(noSubject.subject).toBe('Interview for Sravani Komma');
    expect(buildEventPayload({ ...TASK, 'Start Time Of Interview': 'garbage' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest test/meetingProvisioningService.test.js`
Expected: FAIL — cannot find module / `buildEventPayload` is not exported.

- [ ] **Step 3: Create the service with `buildEventPayload`**

Create `backend/src/services/meetingProvisioningService.js`:

```javascript
import moment from 'moment-timezone';
import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { graphMeetingService } from './graphMeetingService.js';

const LOCK_TTL_MS = 3 * 60 * 1000;
const EVENT_TZ_IANA = 'America/New_York';
const EVENT_TZ_WINDOWS = 'Eastern Standard Time';
const TIME_FORMATS = ['MM/DD/YYYY h:mm A', 'MM/DD/YYYY hh:mm A', 'MM/DD/YYYY HH:mm a'];

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildEventPayload(taskDoc) {
  const dateStr = taskDoc?.['Date of Interview'];
  const startStr = taskDoc?.['Start Time Of Interview'];
  const endStr = taskDoc?.['End Time Of Interview'];

  const start = moment.tz(`${dateStr} ${startStr}`, TIME_FORMATS, EVENT_TZ_IANA);
  const end = moment.tz(`${dateStr} ${endStr}`, TIME_FORMATS, EVENT_TZ_IANA);
  if (!start.isValid() || !end.isValid()) {
    logger.warn('buildEventPayload: invalid interview times', { taskId: taskDoc?._id });
    return null;
  }

  const candidate = taskDoc['Candidate Name'] || 'candidate';
  const subject = taskDoc.subject || `Interview for ${candidate}`;
  const bodyHtml = [
    '<div>',
    `<p><strong>Candidate:</strong> ${escapeHtml(taskDoc['Candidate Name'] || '')}</p>`,
    `<p><strong>Client:</strong> ${escapeHtml(taskDoc['End Client'] || '')}</p>`,
    `<p><strong>Round:</strong> ${escapeHtml(taskDoc['Interview Round'] || '')}</p>`,
    '<p>Join via the Microsoft Teams meeting button on this event.</p>',
    '</div>',
  ].join('');

  return {
    subject,
    body: { contentType: 'HTML', content: bodyHtml },
    start: { dateTime: start.format('YYYY-MM-DDTHH:mm:ss'), timeZone: EVENT_TZ_WINDOWS },
    end: { dateTime: end.format('YYYY-MM-DDTHH:mm:ss'), timeZone: EVENT_TZ_WINDOWS },
    attendees: [
      { emailAddress: { address: 'harsh.patel@silverspaceinc.com', name: 'Harsh Patel' }, type: 'required' },
      { emailAddress: { address: 'fred@fireflies.ai', name: 'Fred (Fireflies)' }, type: 'required' },
    ],
    isOnlineMeeting: true,
    onlineMeetingProvider: 'teamsForBusiness',
    location: { displayName: 'Microsoft Teams Meeting' },
  };
}
```

> Note: the `'1:00 PM'` end time parses via `MM/DD/YYYY h:mm A`; the `HH:mm a` format is kept for parity with `Task.formatTask`. `moment-timezone` is already a backend dependency (used by `Task.js`).

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest test/meetingProvisioningService.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/meetingProvisioningService.js backend/test/meetingProvisioningService.test.js
git commit -m "feat(meetings): buildEventPayload for server-side meeting events"
```

---

## Task 3: `meetingProvisioningService.ensureMeetingForTask`

The idempotent orchestration: short-circuit on an existing link, atomic claim, create via Graph, lobby bypass (best-effort), persist + release. Returns `{ status: 'exists' | 'created' | 'pending', meetingLink? }`.

**Files:**
- Modify: `backend/src/services/meetingProvisioningService.js`
- Test: `backend/test/meetingProvisioningService.test.js` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/meetingProvisioningService.test.js`:

```javascript
import { jest, beforeEach, afterEach } from '@jest/globals';
import { ensureMeetingForTask } from '../src/services/meetingProvisioningService.js';
import { database } from '../src/config/database.js';
import { graphMeetingService } from '../src/services/graphMeetingService.js';

const VALID_ID = '507f1f77bcf86cd799439011';
const origGetCollection = database.getCollection;

function mockCollection({ taskDoc, claimResult }) {
  const findOne = jest.fn().mockResolvedValue(taskDoc);
  const findOneAndUpdate = jest.fn().mockResolvedValue(claimResult);
  const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
  const col = { findOne, findOneAndUpdate, updateOne };
  database.getCollection = jest.fn(() => col);
  return col;
}

afterEach(() => { database.getCollection = origGetCollection; jest.restoreAllMocks(); });

const TASK_FULL = {
  _id: VALID_ID, subject: 'I', 'Candidate Name': 'C', 'End Client': 'X', 'Interview Round': 'R',
  'Date of Interview': '06/02/2026', 'Start Time Of Interview': '12:00 PM', 'End Time Of Interview': '1:00 PM',
};

describe('ensureMeetingForTask', () => {
  it('short-circuits without any Graph call when a link already exists', async () => {
    const col = mockCollection({ taskDoc: { ...TASK_FULL, meetingLink: 'https://teams/old' }, claimResult: null });
    const createSpy = jest.spyOn(graphMeetingService, 'createEventMeeting');

    const out = await ensureMeetingForTask({ taskId: VALID_ID, userAssertion: 't', actorEmail: 'a@b.com' });

    expect(out).toMatchObject({ status: 'exists', meetingLink: 'https://teams/old' });
    expect(col.findOneAndUpdate).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('claims, creates, bypasses, persists and releases the lock on the happy path', async () => {
    const col = mockCollection({ taskDoc: TASK_FULL, claimResult: { ...TASK_FULL, meetingCreationLockAt: new Date() } });
    jest.spyOn(graphMeetingService, 'createEventMeeting').mockResolvedValue({ onlineMeeting: { joinUrl: 'https://teams/new' } });
    jest.spyOn(graphMeetingService, 'setMeetingLobbyBypass').mockResolvedValue({});

    const out = await ensureMeetingForTask({ taskId: VALID_ID, userAssertion: 't', actorEmail: 'a@b.com' });

    expect(out).toMatchObject({ status: 'created', meetingLink: 'https://teams/new' });
    const persist = col.updateOne.mock.calls.at(-1)[1];
    expect(persist.$set).toMatchObject({ meetingLink: 'https://teams/new', joinUrl: 'https://teams/new', joinWebUrl: 'https://teams/new', botStatus: 'pending' });
    expect(persist.$unset).toMatchObject({ meetingCreationLockAt: '', meetingCreationLockBy: '' });
  });

  it('returns pending when the claim is lost and no link is present', async () => {
    mockCollection({ taskDoc: TASK_FULL, claimResult: null }); // findOne returns no link, claim returns null
    const createSpy = jest.spyOn(graphMeetingService, 'createEventMeeting');
    const out = await ensureMeetingForTask({ taskId: VALID_ID, userAssertion: 't', actorEmail: 'a@b.com' });
    expect(out).toMatchObject({ status: 'pending' });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('still succeeds (created) when lobby bypass fails', async () => {
    const col = mockCollection({ taskDoc: TASK_FULL, claimResult: { ...TASK_FULL } });
    jest.spyOn(graphMeetingService, 'createEventMeeting').mockResolvedValue({ onlineMeeting: { joinUrl: 'https://teams/new' } });
    jest.spyOn(graphMeetingService, 'setMeetingLobbyBypass').mockRejectedValue(new Error('bypass down'));
    const out = await ensureMeetingForTask({ taskId: VALID_ID, userAssertion: 't', actorEmail: 'a@b.com' });
    expect(out).toMatchObject({ status: 'created', meetingLink: 'https://teams/new' });
    expect(col.updateOne).toHaveBeenCalled(); // link still persisted
  });

  it('releases the lock and rethrows when Graph create fails', async () => {
    const col = mockCollection({ taskDoc: TASK_FULL, claimResult: { ...TASK_FULL } });
    jest.spyOn(graphMeetingService, 'createEventMeeting').mockRejectedValue(new Error('graph 500'));
    await expect(ensureMeetingForTask({ taskId: VALID_ID, userAssertion: 't', actorEmail: 'a@b.com' })).rejects.toThrow('graph 500');
    const release = col.updateOne.mock.calls.at(-1)[1];
    expect(release.$unset).toMatchObject({ meetingCreationLockAt: '', meetingCreationLockBy: '' });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest test/meetingProvisioningService.test.js`
Expected: FAIL — `ensureMeetingForTask` not exported.

- [ ] **Step 3: Implement `ensureMeetingForTask`**

Append to `backend/src/services/meetingProvisioningService.js`:

```javascript
const TASK_COLLECTION = 'taskBody';

function hasLink(doc) {
  return Boolean(doc && (doc.meetingLink || doc.joinUrl || doc.joinWebUrl));
}

function linkOf(doc) {
  return (doc && (doc.meetingLink || doc.joinUrl || doc.joinWebUrl)) || '';
}

export async function ensureMeetingForTask({ taskId, userAssertion, actorEmail }) {
  if (!ObjectId.isValid(taskId)) {
    const err = new Error('Invalid taskId');
    err.statusCode = 400;
    throw err;
  }
  const _id = new ObjectId(taskId);
  const col = database.getCollection(TASK_COLLECTION);

  // 1. Short-circuit: a meeting already exists → no Graph call.
  const current = await col.findOne({ _id });
  if (!current) {
    const err = new Error('Task not found');
    err.statusCode = 404;
    throw err;
  }
  if (hasLink(current)) {
    return { status: 'exists', meetingLink: linkOf(current) };
  }

  // 2. Atomic claim: only one caller transitions an unlinked, unlocked
  //    (or stale-locked) task into the locked state.
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - LOCK_TTL_MS);
  const claim = await col.findOneAndUpdate(
    {
      _id,
      $and: [
        { $or: [{ meetingLink: { $in: [null, ''] } }, { meetingLink: { $exists: false } }] },
        { $or: [{ joinUrl: { $in: [null, ''] } }, { joinUrl: { $exists: false } }] },
        { $or: [{ joinWebUrl: { $in: [null, ''] } }, { joinWebUrl: { $exists: false } }] },
        { $or: [
          { meetingCreationLockAt: { $exists: false } },
          { meetingCreationLockAt: null },
          { meetingCreationLockAt: { $lt: staleCutoff } },
        ] },
      ],
    },
    { $set: { meetingCreationLockAt: now, meetingCreationLockBy: actorEmail || null } },
    { returnDocument: 'after' }
  );

  if (!claim) {
    // Lost the claim: either a link appeared, or someone else holds a fresh lock.
    const recheck = await col.findOne({ _id });
    if (hasLink(recheck)) return { status: 'exists', meetingLink: linkOf(recheck) };
    return { status: 'pending' };
  }

  // 3. We hold the lock. Create the event via OBO; release the lock on any failure.
  try {
    const payload = buildEventPayload(claim);
    if (!payload) {
      const err = new Error('Task has invalid interview times');
      err.statusCode = 422;
      throw err;
    }
    const event = await graphMeetingService.createEventMeeting(userAssertion, payload);
    const joinUrl = event?.onlineMeeting?.joinUrl || '';
    if (!joinUrl) {
      const err = new Error('Graph did not return a join URL');
      err.statusCode = 502;
      throw err;
    }

    // 4. Lobby bypass = everyone (best-effort; failure must not lose the meeting).
    try {
      await graphMeetingService.setMeetingLobbyBypass(userAssertion, joinUrl);
    } catch (err) {
      logger.warn('ensureMeetingForTask: lobby bypass failed', { taskId, error: err.message });
    }

    // 5. Persist link + reset bot fields + release lock.
    await col.updateOne(
      { _id },
      {
        $set: {
          meetingLink: joinUrl,
          joinUrl,
          joinWebUrl: joinUrl,
          botStatus: 'pending',
          botInviteAttempts: 0,
          botJoinedAt: null,
          precheckCheckedAt: null,
          botLastError: null,
          updatedAt: new Date(),
        },
        $unset: { meetingCreationLockAt: '', meetingCreationLockBy: '' },
      }
    );

    return { status: 'created', meetingLink: joinUrl };
  } catch (error) {
    // Release the lock so a later retry can proceed.
    await col.updateOne({ _id }, { $unset: { meetingCreationLockAt: '', meetingCreationLockBy: '' } })
      .catch((e) => logger.warn('ensureMeetingForTask: failed to release lock', { taskId, error: e.message }));
    throw error;
  }
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest test/meetingProvisioningService.test.js`
Expected: PASS (all `buildEventPayload` + `ensureMeetingForTask` tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/meetingProvisioningService.js backend/test/meetingProvisioningService.test.js
git commit -m "feat(meetings): idempotent ensureMeetingForTask (atomic claim + create + persist)"
```

---

## Task 4: `taskController.ensureMeeting` + route

Thin controller that extracts the Bearer token (OBO assertion), calls the service, and maps the result to status codes.

**Files:**
- Modify: `backend/src/controllers/taskController.js`
- Modify: `backend/src/routes/tasks.js`
- Test: `backend/test/taskController.ensureMeeting.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// backend/test/taskController.ensureMeeting.test.js
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockEnsure = jest.fn();
jest.unstable_mockModule('../src/services/meetingProvisioningService.js', () => ({
  ensureMeetingForTask: mockEnsure,
  buildEventPayload: jest.fn(),
}));
jest.unstable_mockModule('../src/middleware/errorHandler.js', () => ({ asyncHandler: (fn) => fn }));
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.unstable_mockModule('../src/config/database.js', () => ({ database: { getCollection: jest.fn() } }));
jest.unstable_mockModule('../src/services/taskService.js', () => ({ taskService: {} }));
jest.unstable_mockModule('../src/services/thanksMailService.js', () => ({ thanksMailService: {} }));
jest.unstable_mockModule('../src/services/interviewerQuestionService.js', () => ({ interviewerQuestionService: {} }));
jest.unstable_mockModule('../src/services/interviewDebriefService.js', () => ({ interviewDebriefService: {} }));

const { taskController } = await import('../src/controllers/taskController.js');

function res() {
  const r = { statusCode: 200, body: undefined };
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((p) => { r.body = p; return r; });
  return r;
}
const req = (over = {}) => ({ params: { taskId: '507f1f77bcf86cd799439011' }, headers: { authorization: 'Bearer abc' }, user: { email: 'a@b.com' }, ...over });

beforeEach(() => jest.clearAllMocks());

describe('taskController.ensureMeeting', () => {
  it('201 when created', async () => {
    mockEnsure.mockResolvedValue({ status: 'created', meetingLink: 'https://teams/new' });
    const r = res();
    await taskController.ensureMeeting(req(), r);
    expect(mockEnsure).toHaveBeenCalledWith({ taskId: '507f1f77bcf86cd799439011', userAssertion: 'abc', actorEmail: 'a@b.com' });
    expect(r.statusCode).toBe(201);
    expect(r.body).toMatchObject({ created: true, meetingLink: 'https://teams/new' });
  });

  it('200 with created:false when it already exists', async () => {
    mockEnsure.mockResolvedValue({ status: 'exists', meetingLink: 'https://teams/old' });
    const r = res();
    await taskController.ensureMeeting(req(), r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ created: false, meetingLink: 'https://teams/old' });
  });

  it('202 when pending', async () => {
    mockEnsure.mockResolvedValue({ status: 'pending' });
    const r = res();
    await taskController.ensureMeeting(req(), r);
    expect(r.statusCode).toBe(202);
    expect(r.body).toMatchObject({ pending: true });
  });

  it('401 when no bearer token', async () => {
    const r = res();
    await taskController.ensureMeeting(req({ headers: {} }), r);
    expect(r.statusCode).toBe(401);
    expect(mockEnsure).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest test/taskController.ensureMeeting.test.js`
Expected: FAIL — `taskController.ensureMeeting is not a function`.

- [ ] **Step 3: Implement the controller handler**

In `backend/src/controllers/taskController.js`, add the import near the top (with the other service imports):

```javascript
import { ensureMeetingForTask } from '../services/meetingProvisioningService.js';
```

Add this method to the `TaskController` class, right after `updateMeetingLink`:

```javascript
  ensureMeeting = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const authHeader = req.headers?.authorization || '';
    const userAssertion = /^Bearer\s+(.+)/i.exec(authHeader)?.[1] || '';
    if (!userAssertion) {
      return res.status(401).json({ success: false, error: 'Missing bearer token' });
    }

    let result;
    try {
      result = await ensureMeetingForTask({
        taskId,
        userAssertion,
        actorEmail: req.user?.email || null,
      });
    } catch (err) {
      const status = err.statusCode || 500;
      logger.error('ensureMeeting failed', { taskId, error: err.message });
      return res.status(status).json({ success: false, error: err.message });
    }

    if (result.status === 'created') {
      return res.status(201).json({ success: true, created: true, meetingLink: result.meetingLink, joinUrl: result.meetingLink, joinWebUrl: result.meetingLink });
    }
    if (result.status === 'exists') {
      return res.status(200).json({ success: true, created: false, meetingLink: result.meetingLink, joinUrl: result.meetingLink, joinWebUrl: result.meetingLink });
    }
    return res.status(202).json({ success: true, pending: true });
  });
```

- [ ] **Step 4: Add the route**

In `backend/src/routes/tasks.js`, add after the `meeting-link` route (line ~20):

```javascript
router.post('/:taskId/ensure-meeting', taskController.ensureMeeting);
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest test/taskController.ensureMeeting.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Syntax-check the touched backend files**

Run: `cd backend && node --check src/controllers/taskController.js && node --check src/routes/tasks.js && node --check src/services/meetingProvisioningService.js && node --check src/services/graphMeetingService.js`
Expected: no output (all parse).

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/taskController.js backend/src/routes/tasks.js backend/test/taskController.ensureMeeting.test.js
git commit -m "feat(meetings): POST /api/tasks/:taskId/ensure-meeting endpoint"
```

---

## Task 5: Frontend — route creation through the endpoint

`handleCreateMeeting` calls `ensure-meeting` (Bearer = the backend token, exactly as the lobby-bypass call did) and updates local state from the response. Remove the now-unused `createOutlookEvent`. The auto-create effect is unchanged — it still calls `handleCreateMeeting`, which is now idempotent server-side.

**Files:**
- Modify: `frontend/src/pages/TasksToday.tsx`

- [ ] **Step 1: Replace the body of `handleCreateMeeting`**

Find the block in `handleCreateMeeting` from `const start = parseStart(task);` through the end of the `if (resolvedLink) { ... }` block (the create + setTasks + lobby-bypass + persist + clipboard logic — everything between acquiring `userToken` and the closing of the success path). Replace it with:

```typescript
        // One meeting per task, created + persisted server-side and gated by
        // an atomic claim, so reloads / concurrent tabs can't duplicate it.
        const res = await fetch(`${API_URL}/api/tasks/${task._id}/ensure-meeting`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${userToken}`,
          },
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          toast({
            title: 'Could not create meeting',
            description: data?.error || 'Please try again.',
            variant: 'destructive',
          });
          return;
        }

        if (data?.pending) {
          // Another request is creating it right now; it will appear on the
          // next list refresh. Do nothing (no duplicate creation).
          return;
        }

        const link: string =
          data?.meetingLink || data?.joinUrl || data?.joinWebUrl || '';
        if (link) {
          setTasks((prev) =>
            prev.map((item) =>
              item._id === task._id
                ? { ...item, meetingLink: link, joinUrl: link, joinWebUrl: link }
                : item
            )
          );
          try {
            await navigator.clipboard.writeText(link);
            toast({
              title: data?.created ? 'Teams meeting created' : 'Meeting ready',
              description: 'Join link copied to your clipboard.',
            });
          } catch {
            toast({
              title: data?.created ? 'Teams meeting created' : 'Meeting ready',
              description: `Join link: ${link}`,
            });
          }
        }
```

> Keep everything above this point unchanged (the `canManageMeetings` guard, `setMeetingBusyState`, `ensureMicrosoftAccount`, `needsConsent`/`openConsentDialog`, and the `userToken = await acquireBackendToken(...)` acquisition — the backend uses `userToken` as the OBO assertion). Keep the `finally { setMeetingBusyState(task._id, false); }` and any PostHog capture that follows. Remove the `const start`/`const end`/`void end;` lines and the `createOutlookEvent` call.

- [ ] **Step 2: Remove the now-unused `createOutlookEvent`**

Delete the entire `const createOutlookEvent = useCallback(async (task, accountOverride) => { ... }, [deps]);` definition (it has no remaining callers). Then remove `createOutlookEvent` from the dependency array of `handleCreateMeeting`'s `useCallback`.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0. If `tsc` flags an unused import (e.g., `parseStart`/`parseEnd`/`WINDOWS_TZ`/`TZ`/`DOMPurify` now unused), remove only the ones that are genuinely unused (confirm with a grep before deleting — they may still be used elsewhere in the file).

- [ ] **Step 4: Grep to confirm no dangling references**

Run: `cd frontend && grep -n "createOutlookEvent" src/pages/TasksToday.tsx`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/TasksToday.tsx
git commit -m "feat(meetings): TasksToday creates meetings via the idempotent ensure-meeting endpoint"
```

---

## Task 6: Full verification + PR

- [ ] **Step 1: Run the full set of touched + related backend suites**

Run:
```bash
cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest \
  test/graphMeetingService.createEventMeeting.test.js \
  test/meetingProvisioningService.test.js \
  test/taskController.ensureMeeting.test.js \
  test/taskController.updateMeetingLink.test.js \
  test/graphMeetings.controller.test.js \
  test/graphMeetingController.test.js
```
Expected: all green. (Including the pre-existing graph meeting tests, to confirm no regression to `graphMeetingService`.)

- [ ] **Step 2: Frontend type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin feat/server-side-meeting-idempotency
gh pr create --base main --title "feat(meetings): server-side idempotent meeting creation (one meeting per task, guaranteed)" --body "<summary referencing docs/superpowers/specs/2026-06-02-meeting-idempotency-design.md>"
```

- [ ] **Step 4: Watch CI to green, then report.** Do NOT merge without explicit user approval.

---

## Self-review notes (for the implementer)

- **Spec coverage:** endpoint contract (Task 4 → 200/201/202), atomic claim (Task 3), server event payload incl. Fireflies attendee (Task 2), lobby bypass best-effort (Task 3), persist+release+`LOCK_TTL` (Task 3), client routing through the endpoint (Task 5), back-compat short-circuit (Task 3, `hasLink`), tests (every task). All covered.
- **Token mechanism:** OBO assertion is the request Bearer token (matches `graphMeetingController.createMeeting`/`bypassLobby`); the client sends `Authorization: Bearer ${userToken}` exactly as the existing lobby-bypass call did. (Refinement over the spec's `x-graph-access-token` note — documented in the handoff.)
- **Type/name consistency:** service exports `buildEventPayload` + `ensureMeetingForTask`; controller imports `ensureMeetingForTask`; result `status` values `'exists' | 'created' | 'pending'` are mapped consistently in Task 4.
- **No new index needed:** the claim filters on `_id` (already unique-indexed) plus link/lock fields on a single doc.
