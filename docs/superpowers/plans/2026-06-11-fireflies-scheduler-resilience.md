# Fireflies Scheduler Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work on a branch `fix/fireflies-scheduler-resilience` (worktree recommended).

**Goal:** The Fireflies bot scheduler must never again skip a month of invites silently: rate-limit skips become visible (audit + warn), missed windows get a bounded catch-up sweep, read-path 429s stop blocking invite mutations, and only one backend color runs the tick.

**Architecture:** Four surgical changes to two files — `backend/src/jobs/firefliesBotScheduler.js` (tick gate visibility, catch-up grace, Mongo tick lease) and `backend/src/services/firefliesService.js` (split read/invite cooldown clocks + cap). No new collections except `schedulerLocks` (one doc). All behavior covered by a new Jest suite using `jest.unstable_mockModule` (repo precedent: `candidateController.*.test.js`).

**Tech stack:** Node ESM, Jest (`NODE_OPTIONS=--experimental-vm-modules`), mongodb driver ^6.20.0 (`findOneAndUpdate` returns the doc directly, not `{value}`), moment-timezone.

**Background (diagnosed 2026-06-11, prod evidence):** a single 429 from ANY firefliesService caller set the shared in-process cooldown (often `retry after <next midnight UTC>`), and `tick()` returned at a debug-only gate with no audit row — `botInviteAttempts: 0, botLastError: null` and zero `FIREFLIES_*` audit rows for a month. Stage C's hard `minutesUntil > -5` bound meant a cooldown outliving the window orphaned the task permanently.

---

## Task 0: Branch + test scaffolding

**Files:**
- Create: `backend/src/jobs/__tests__/firefliesBotScheduler.test.js`

- [ ] **Step 0.1: Create the branch**

```bash
cd C:\Users\Administrator\Projects\dailyDashboard
git checkout main && git pull --ff-only
git checkout -b fix/fireflies-scheduler-resilience
```

- [ ] **Step 0.2: Write the shared test harness** (mocks the singletons the scheduler imports; every later task adds cases to this file)

```js
// backend/src/jobs/__tests__/firefliesBotScheduler.test.js
import { jest } from '@jest/globals';
import moment from 'moment-timezone';

// ---- shared mock state, reset per test ----
const ff = {
  enabled: true,
  isRateLimited: jest.fn(() => false),
  getRateLimitedUntil: jest.fn(() => 0),
  inviteBot: jest.fn(async () => ({})),
  isBotInMeeting: jest.fn(async () => true),
};

const auditInserts = [];
const updateOnes = [];
let findResults = [];
let leaseResult = { owner: 'me', expiresAt: new Date(Date.now() + 90000) }; // doc => lease acquired
let leaseError = null;

const fakeTaskCol = {
  find: jest.fn(() => ({
    sort: () => ({ limit: () => ({ toArray: async () => findResults }) }),
  })),
  countDocuments: jest.fn(async () => 0),
  updateOne: jest.fn(async (...a) => { updateOnes.push(a); return { matchedCount: 1 }; }),
};
const fakeAuditCol = { insertOne: jest.fn(async (doc) => { auditInserts.push(doc); }) };
const fakeLockCol = {
  findOneAndUpdate: jest.fn(async () => {
    if (leaseError) throw leaseError;
    return leaseResult;
  }),
};

jest.unstable_mockModule('../../services/firefliesService.js', () => ({
  firefliesService: ff,
  FirefliesRateLimitError: class FirefliesRateLimitError extends Error {
    constructor(retryAfterEpochMs) { super('rate limited'); this.retryAfterEpochMs = retryAfterEpochMs; }
  },
}));
jest.unstable_mockModule('../../config/database.js', () => ({
  database: {
    getDb: () => ({
      collection: (name) => (name === 'schedulerLocks' ? fakeLockCol : fakeTaskCol),
    }),
    getCollection: (name) => (name === 'auditLog' ? fakeAuditCol : fakeTaskCol),
  },
}));
jest.unstable_mockModule('../../models/Task.js', () => ({ TASK_EXCLUDE_HEAVY: {} }));
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { _tick, _testing } = await import('../firefliesBotScheduler.js');
const { logger } = await import('../../utils/logger.js');

// helper: a botable task whose interview started `minutesAgo` minutes ago (EST string format)
const taskStartedMinutesAgo = (minutesAgo, overrides = {}) => ({
  _id: 't1',
  subject: 'Interview Support - Example',
  'Candidate Name': 'Vaishnavi Example',
  meetingLink: 'https://teams.microsoft.com/l/meetup-join/xyz',
  botStatus: 'pending',
  botInviteAttempts: 0,
  interviewDateTime: moment().tz('America/New_York').subtract(minutesAgo, 'minutes').format('YYYY-MM-DDTHH:mm'),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  auditInserts.length = 0;
  updateOnes.length = 0;
  findResults = [];
  leaseResult = { owner: 'me', expiresAt: new Date(Date.now() + 90000) };
  leaseError = null;
  ff.enabled = true;
  ff.isRateLimited.mockReturnValue(false);
  _testing.setLastTickFinishedAt(Date.now());
  _testing.setLastSkipAuditAt(0);
  process.env.FIREFLIES_TICK_PACING_MS = '0';
});

describe('firefliesBotScheduler tick', () => {
  // cases added by Tasks 1, 2, 4 below
});
```

- [ ] **Step 0.3: Run it (must fail — `_testing` doesn't exist yet)**

Run: `cd backend && NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules npx jest src/jobs/__tests__/firefliesBotScheduler.test.js`
Expected: FAIL — the import of `_testing` is undefined. This proves the harness wires up; Task 1 makes it pass.

---

## Task 1: Make the rate-limit skip visible (warn + audit row, throttled)

**Files:**
- Modify: `backend/src/jobs/firefliesBotScheduler.js` (gate at ~line 317-326; `audit()` subject fallback at ~line 26; add module state near line 45; export `_testing` at end)
- Modify: `backend/src/services/firefliesService.js` (add `getRateLimitedUntil()` next to `isRateLimited()` at ~line 80)
- Test: `backend/src/jobs/__tests__/firefliesBotScheduler.test.js`

- [ ] **Step 1.1: Write the failing tests**

```js
it('audits + warns when the tick is skipped by rate-limit cooldown', async () => {
  ff.isRateLimited.mockReturnValue(true);
  ff.getRateLimitedUntil.mockReturnValue(Date.now() + 3600_000);

  await _tick();

  expect(fakeTaskCol.find).not.toHaveBeenCalled();
  expect(logger.warn).toHaveBeenCalledWith(
    expect.stringContaining('tick skipped'), expect.any(Object));
  const row = auditInserts.find((d) => d.phase === 'FIREFLIES_TICK_SKIPPED_RATELIMIT');
  expect(row).toBeTruthy();
  expect(row.level).toBe('warning');
  expect(row.subject).toBe('scheduler');
  expect(row.extra.cooldownUntil).toBeTruthy();
});

it('throttles the skip audit row (one per interval, warn still every tick)', async () => {
  ff.isRateLimited.mockReturnValue(true);
  ff.getRateLimitedUntil.mockReturnValue(Date.now() + 3600_000);

  await _tick();
  await _tick();

  const rows = auditInserts.filter((d) => d.phase === 'FIREFLIES_TICK_SKIPPED_RATELIMIT');
  expect(rows.length).toBe(1);
  expect(logger.warn).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 1.2: Run to verify they fail**

Run: same jest command. Expected: FAIL (`find` not called passes, but no warn/audit yet — and `_testing` still missing).

- [ ] **Step 1.3: Implement**

In `firefliesService.js`, directly under `isRateLimited()`:

```js
  getRateLimitedUntil() {
    return this._rateLimitedUntil;
  }
```

In `firefliesBotScheduler.js` — `audit()` subject line becomes scheduler-row safe:

```js
      subject: task?.subject || task?.Subject || (task?._id ? `task:${task._id}` : 'scheduler'),
```

Module state under `const TIMEZONE = ...`:

```js
// Task-1 visibility: a cooldown skip must leave a trace. The audit row is
// throttled (cooldowns last hours; one row per tick would be spam) but the
// warn fires every skipped tick so `docker logs` shows the condition live.
const SKIP_AUDIT_INTERVAL_MS = parseInt(process.env.FIREFLIES_SKIP_AUDIT_INTERVAL_MS || '600000', 10);
let lastSkipAuditAt = 0;
```

Replace the silent gate inside `tick()`:

```js
  if (firefliesService.isRateLimited()) {
    const until = firefliesService.getRateLimitedUntil();
    logger.warn('Fireflies tick skipped — rate-limit cooldown active', {
      cooldownUntil: new Date(until).toISOString(),
    });
    if (Date.now() - lastSkipAuditAt >= SKIP_AUDIT_INTERVAL_MS) {
      lastSkipAuditAt = Date.now();
      await audit('FIREFLIES_TICK_SKIPPED_RATELIMIT', 'warning', null,
        'Scheduler tick skipped — rate-limit cooldown active',
        { cooldownUntil: new Date(until).toISOString() });
    }
    return;
  }
```

At the bottom of the file, next to `export const _tick = tick;`:

```js
// Test seams — module-level clocks are otherwise unreachable from tests.
export const _testing = {
  setLastTickFinishedAt(v) { lastTickFinishedAt = v; },
  setLastSkipAuditAt(v) { lastSkipAuditAt = v; },
};
```

(`lastTickFinishedAt` arrives in Task 2 — declare both lets in this task so `_testing` compiles: `let lastTickFinishedAt = Date.now();`)

- [ ] **Step 1.4: Run tests — both Task-1 cases pass**

Run: same jest command. Expected: PASS (2 tests).

- [ ] **Step 1.5: Commit**

```bash
git add backend/src/jobs/firefliesBotScheduler.js backend/src/services/firefliesService.js backend/src/jobs/__tests__/firefliesBotScheduler.test.js
git commit -m "fix(fireflies): audit + warn when the scheduler tick is skipped by rate-limit cooldown"
```

---

## Task 2: Catch-up sweep after skipped ticks

**Files:**
- Modify: `backend/src/jobs/firefliesBotScheduler.js` (`processTask` signature ~line 80 + Stage C condition ~line 202; `tick()` window + grace; set `lastTickFinishedAt` at tick end)
- Test: same test file

- [ ] **Step 2.1: Write the failing tests**

```js
it('catch-up: invites a pending task that started 9 min ago after a 10-min tick gap', async () => {
  _testing.setLastTickFinishedAt(Date.now() - 10 * 60_000);
  findResults = [taskStartedMinutesAgo(9)];

  await _tick();

  expect(ff.inviteBot).toHaveBeenCalledTimes(1);
  const set = updateOnes.find(([, u]) => u.$set?.botStatus === 'main_invited');
  expect(set).toBeTruthy();
  expect(auditInserts.some((d) => d.phase === 'FIREFLIES_CATCHUP_SWEEP')).toBe(true);
});

it('no catch-up grace on a normal cadence: a task 9 min past start is NOT invited', async () => {
  findResults = [taskStartedMinutesAgo(9)];   // lastTickFinishedAt = now (beforeEach)

  await _tick();

  expect(ff.inviteBot).not.toHaveBeenCalled();
});

it('catch-up grace is capped: a task 30 min past start is not picked up even after a long gap', async () => {
  _testing.setLastTickFinishedAt(Date.now() - 60 * 60_000);
  findResults = [taskStartedMinutesAgo(30)];

  await _tick();

  expect(ff.inviteBot).not.toHaveBeenCalled();
});
```

- [ ] **Step 2.2: Run to verify they fail** (no grace logic yet → test 1 and 3 fail)

- [ ] **Step 2.3: Implement**

Module consts (next to the Task-1 state):

```js
// Task-2 catch-up: when ticks were skipped (cooldown, restart, lease
// handover), the first live tick widens Stage C's late bound so meetings
// that started during the gap still get a bot — capped so we never join
// a meeting that is mostly over.
const CATCHUP_MAX_LATE_MIN = parseInt(process.env.FIREFLIES_CATCHUP_MAX_LATE_MIN || '15', 10);
```

`processTask` gains a grace param — signature and Stage C condition:

```js
async function processTask(collection, task, lateGraceMin = 0) {
```

```js
  // Stage C — Main bot invite (T+0 to T+5, extended by catch-up grace)
  if (
    minutesUntil <= 0 &&
    minutesUntil > -(5 + lateGraceMin) &&
    ['pending', 'precheck_joined', 'precheck_failed'].includes(botStatus)
  ) {
```

In `tick()` right after the rate-limit gate:

```js
    const gapMs = Date.now() - lastTickFinishedAt;
    const lateGraceMin = gapMs > TICK_INTERVAL_MS * 2.5
      ? Math.min(CATCHUP_MAX_LATE_MIN, Math.ceil(gapMs / 60_000))
      : 0;
    if (lateGraceMin > 0) {
      logger.warn('Fireflies catch-up sweep — extending late window after skipped ticks', {
        gapMinutes: Math.round(gapMs / 60_000), lateGraceMin,
      });
      await audit('FIREFLIES_CATCHUP_SWEEP', 'info', null,
        `Catch-up after ~${Math.round(gapMs / 60_000)} min without a completed tick`,
        { lateGraceMin });
    }
```

Widen the query's lower bound (the existing `cutoffStart` line):

```js
    const cutoffStart = moment().tz(TIMEZONE).subtract(10 + lateGraceMin, 'minutes').format('YYYY-MM-DDTHH:mm');
```

Thread the grace into the loop call:

```js
        await processTask(collection, task, lateGraceMin);
```

At the very end of `tick()`'s `try` block (after the for-loop):

```js
    lastTickFinishedAt = Date.now();
```

(Deliberately NOT set on the skip/lease/error paths — a stale clock is what arms the catch-up.)

- [ ] **Step 2.4: Run tests — all Task-2 cases pass** (and Task-1 cases still pass)

- [ ] **Step 2.5: Commit**

```bash
git add backend/src/jobs/firefliesBotScheduler.js backend/src/jobs/__tests__/firefliesBotScheduler.test.js
git commit -m "feat(fireflies): bounded catch-up sweep after skipped scheduler ticks"
```

---

## Task 3: Scope the cooldown — read 429s must not block invites; cap the clock

**Files:**
- Modify: `backend/src/services/firefliesService.js` (constructor ~line 74, `isRateLimited`/`getRateLimitedUntil` ~line 80, `_applyRateLimit` ~line 87, `_request` gate ~line 112 + both `_applyRateLimit` call sites at lines ~151/177, `inviteBot` ~line 221)
- Modify: `backend/src/jobs/firefliesBotScheduler.js` (tick gate uses `isRateLimited('invite')` / `getRateLimitedUntil('invite')`)
- Test: Create `backend/src/services/__tests__/firefliesService.rateLimitScope.test.js`

- [ ] **Step 3.1: Write the failing tests**

```js
// backend/src/services/__tests__/firefliesService.rateLimitScope.test.js
import { jest } from '@jest/globals';

process.env.FIREFLIES_API_KEY = 'test-key';
process.env.FIREFLIES_COOLDOWN_CAP_MS = String(60 * 60 * 1000);
const { firefliesService } = await import('../firefliesService.js');

beforeEach(() => {
  firefliesService._rateLimitedUntil = 0;
  firefliesService._inviteRateLimitedUntil = 0;
});

describe('scoped rate-limit clocks', () => {
  it('a read-path 429 blocks reads but NOT invites', () => {
    firefliesService._applyRateLimit(Date.now() + 10 * 60_000, 'graphql-too-many-requests', 'read');
    expect(firefliesService.isRateLimited('read')).toBe(true);
    expect(firefliesService.isRateLimited('invite')).toBe(false);
  });

  it('an invite-path 429 blocks both clocks', () => {
    firefliesService._applyRateLimit(Date.now() + 10 * 60_000, 'graphql-too-many-requests', 'invite');
    expect(firefliesService.isRateLimited('read')).toBe(true);
    expect(firefliesService.isRateLimited('invite')).toBe(true);
  });

  it('caps an absurd retry-after (e.g. next midnight) at FIREFLIES_COOLDOWN_CAP_MS', () => {
    firefliesService._applyRateLimit(Date.now() + 24 * 60 * 60_000, 'http-429', 'invite');
    const until = firefliesService.getRateLimitedUntil('invite');
    expect(until - Date.now()).toBeLessThanOrEqual(60 * 60_000 + 1000);
  });

  it('isRateLimited() defaults to the read clock (back-compat for existing callers)', () => {
    firefliesService._applyRateLimit(Date.now() + 60_000, 'x', 'read');
    expect(firefliesService.isRateLimited()).toBe(true);
  });
});
```

- [ ] **Step 3.2: Run to verify they fail** (`isRateLimited('invite')` returns the shared clock today)

Run: `NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules npx jest src/services/__tests__/firefliesService.rateLimitScope.test.js`

- [ ] **Step 3.3: Implement in `firefliesService.js`**

Constructor — second clock + cap:

```js
    this._rateLimitedUntil = 0;        // read operations (status checks, diagnostics)
    this._inviteRateLimitedUntil = 0;  // invite mutations only — the scheduler gates on this
```

Module const above the class:

```js
// Fireflies has answered 429 with "retry after next midnight UTC" — honoring
// that verbatim silenced the scheduler for a whole day. Cap how long any
// single 429 can mute us; worst case we probe once per cap window.
const COOLDOWN_CAP_MS = parseInt(process.env.FIREFLIES_COOLDOWN_CAP_MS || String(60 * 60 * 1000), 10);
```

Replace `isRateLimited` / add kind-aware getter / rework `_applyRateLimit`:

```js
  isRateLimited(kind = 'read') {
    const until = kind === 'invite' ? this._inviteRateLimitedUntil : this._rateLimitedUntil;
    return Date.now() < until;
  }

  getRateLimitedUntil(kind = 'read') {
    return kind === 'invite' ? this._inviteRateLimitedUntil : this._rateLimitedUntil;
  }

  _applyRateLimit(retryAfterEpochMs, source, op = 'read') {
    const capped = Math.min(retryAfterEpochMs, Date.now() + COOLDOWN_CAP_MS);
    if (capped > this._rateLimitedUntil) {
      this._rateLimitedUntil = capped;
    }
    if (op === 'invite' && capped > this._inviteRateLimitedUntil) {
      this._inviteRateLimitedUntil = capped;
    }
    const seconds = Math.ceil((capped - Date.now()) / 1000);
    logger.warn('Fireflies rate-limited — cooldown engaged', {
      source,
      op,
      until: new Date(capped).toISOString(),
      seconds,
      cappedFrom: retryAfterEpochMs !== capped ? new Date(retryAfterEpochMs).toISOString() : undefined,
    });
  }
```

(Keep the body of the existing `_applyRateLimit` log; the snippet above is the full replacement.)

`_request` — accept and thread the op (signature, entry gate, both 429 call sites):

```js
  async _request(query, variables = {}, { maxAttempts = 3, op = 'read' } = {}) {
```

```js
    if (this.isRateLimited(op)) {
      throw new FirefliesRateLimitError(this.getRateLimitedUntil(op), null);
    }
```

```js
            this._applyRateLimit(retryAfter, 'http-429', op);
```

```js
            this._applyRateLimit(retryAfter, 'graphql-too-many-requests', op);
```

`inviteBot` — tag its request:

```js
    const data = await this._request(query, variables, { op: 'invite' });
```

- [ ] **Step 3.4: Point the scheduler gate at the invite clock** (in `firefliesBotScheduler.js`, the Task-1 gate)

```js
  if (firefliesService.isRateLimited('invite')) {
    const until = firefliesService.getRateLimitedUntil('invite');
```

And update the scheduler test's `beforeEach` expectation: `ff.isRateLimited` is now called with `'invite'` — no change needed (mock ignores args), but add one assertion to the Task-1 test:

```js
  expect(ff.isRateLimited).toHaveBeenCalledWith('invite');
```

- [ ] **Step 3.5: Run BOTH new test files + the existing fireflies-related suites**

Run: `NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules npx jest firefliesService firefliesBotScheduler`
Expected: PASS. (If a pre-existing `firefliesService` test asserts the old `_applyRateLimit` arity, update it to pass `op` explicitly — same behavior for `'read'`.)

- [ ] **Step 3.6: Commit**

```bash
git add backend/src/services/firefliesService.js backend/src/services/__tests__/firefliesService.rateLimitScope.test.js backend/src/jobs/firefliesBotScheduler.js backend/src/jobs/__tests__/firefliesBotScheduler.test.js
git commit -m "fix(fireflies): scope rate-limit cooldown per operation and cap retry-after"
```

---

## Task 4: Single-owner tick lease (blue/green double-invite guard)

**Files:**
- Modify: `backend/src/jobs/firefliesBotScheduler.js` (import `os`; lease helper; gate at the top of `tick()`)
- Test: same scheduler test file

- [ ] **Step 4.1: Write the failing tests**

```js
it('skips the tick when another instance holds the lease', async () => {
  leaseResult = null;   // driver v6: no doc matched => lease held elsewhere
  findResults = [taskStartedMinutesAgo(2)];

  await _tick();

  expect(fakeTaskCol.find).not.toHaveBeenCalled();
  expect(ff.inviteBot).not.toHaveBeenCalled();
});

it('treats a duplicate-key race on lease upsert as "lease held elsewhere"', async () => {
  leaseError = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
  findResults = [taskStartedMinutesAgo(2)];

  await _tick();

  expect(ff.inviteBot).not.toHaveBeenCalled();
});

it('runs the tick when the lease is acquired', async () => {
  findResults = [taskStartedMinutesAgo(2)];   // leaseResult = doc (beforeEach)

  await _tick();

  expect(fakeLockCol.findOneAndUpdate).toHaveBeenCalled();
  expect(ff.inviteBot).toHaveBeenCalledTimes(1);   // Stage C: 2 min past start
});
```

- [ ] **Step 4.2: Run to verify the first two fail** (no lease logic yet → invites fire)

- [ ] **Step 4.3: Implement**

Import at top of the scheduler:

```js
import os from 'os';
```

Helper above `tick()`:

```js
// Both blue/green backends run this scheduler; without ownership each
// in-window task could be invited twice. A short Mongo lease makes exactly
// one process the owner per tick window; on owner death the lease expires
// and the other color takes over within ~LEASE_MS (the Task-2 catch-up
// covers the handover gap).
const LEASE_MS = 90_000;
const LEASE_OWNER = `${os.hostname()}:${process.pid}`;

async function acquireTickLease(db) {
  const now = new Date();
  try {
    const doc = await db.collection('schedulerLocks').findOneAndUpdate(
      {
        _id: 'firefliesBotScheduler',
        $or: [{ owner: LEASE_OWNER }, { expiresAt: { $lt: now } }],
      },
      { $set: { owner: LEASE_OWNER, expiresAt: new Date(now.getTime() + LEASE_MS) } },
      { upsert: true, returnDocument: 'after' }
    );
    // driver v6 returns the doc (or null); v5 wrapped it in { value }
    return Boolean(doc && (doc.value !== undefined ? doc.value : doc));
  } catch (err) {
    if (err && err.code === 11000) return false; // upsert raced an unexpired holder
    throw err;
  }
}
```

Gate at the top of `tick()` (after the `enabled` check, BEFORE the rate-limit gate, so only the owner writes skip-audit rows):

```js
  try {
    if (!(await acquireTickLease(database.getDb()))) {
      logger.debug('Fireflies tick skipped — lease held by another instance');
      return;
    }
  } catch (err) {
    logger.error('Fireflies tick lease check failed — skipping tick', { error: err.message });
    return;
  }
```

- [ ] **Step 4.4: Run the scheduler suite — all cases pass** (earlier tests acquire the lease via the default `leaseResult`)

- [ ] **Step 4.5: Commit**

```bash
git add backend/src/jobs/firefliesBotScheduler.js backend/src/jobs/__tests__/firefliesBotScheduler.test.js
git commit -m "fix(fireflies): single-owner tick lease so only one backend color invites"
```

---

## Task 5: Full verify + PR

- [ ] **Step 5.1: Full backend suite** (offline failures for Atlas-dependent suites are pre-existing — diff against main per CLAUDE.md)

Run: `cd backend && npm test 2>&1 | tail -20`
Expected: no NEW failures vs main; the two new fireflies suites green.

- [ ] **Step 5.2: Syntax sanity on both touched files**

Run: `node --check src/jobs/firefliesBotScheduler.js && node --check src/services/firefliesService.js`
Expected: silence.

- [ ] **Step 5.3: Push + PR**

```bash
git push -u origin fix/fireflies-scheduler-resilience
gh pr create --base main --title "fix(fireflies): visible skips, catch-up sweep, scoped+capped cooldown, single-owner tick" --body "Closes the silent-month failure: (1) rate-limit tick skips now warn + write a throttled FIREFLIES_TICK_SKIPPED_RATELIMIT audit row; (2) the first tick after a gap runs a bounded catch-up sweep (Stage C late window extended up to FIREFLIES_CATCHUP_MAX_LATE_MIN=15) so meetings that started during a cooldown still get a bot; (3) the cooldown is split per operation — read-path 429s (status checks/diagnostics) no longer block invite mutations — and any retry-after is capped at FIREFLIES_COOLDOWN_CAP_MS=60min; (4) a Mongo schedulerLocks lease makes exactly one backend color run the tick, with catch-up covering owner handover. New env knobs: FIREFLIES_SKIP_AUDIT_INTERVAL_MS, FIREFLIES_CATCHUP_MAX_LATE_MIN, FIREFLIES_COOLDOWN_CAP_MS."
```

- [ ] **Step 5.4: Post-deploy verification (prod, after merge)**

1. `GET /api/admin/fireflies/run-tick` once → auditLog should show either normal processing or a `FIREFLIES_TICK_SKIPPED_RATELIMIT` row — never silence.
2. Next real in-window meeting: confirm `FIREFLIES_INVITE_ATTEMPT` → `INVITE_SUCCESS` rows + `botInviteAttempts >= 1`.
3. `db.schedulerLocks.findOne({_id:'firefliesBotScheduler'})` — owner flips only on deploys/restarts.

---

## Self-review notes

- **Spec coverage:** fix #1 → Task 1; fix #2 → Task 2; fix #3 → Task 3; fix #4 → Task 4. Post-deploy manual verification → Task 5.4.
- **Type consistency:** `isRateLimited(kind)` / `getRateLimitedUntil(kind)` defined in Task 3 are the same signatures the Task-1 gate migrates to in Step 3.4; `_testing` seam created in Task 1 is used by Tasks 2/4 tests; `lastTickFinishedAt` declared in Task 1 (compile), armed in Task 2.
- **Known interaction:** lease handover leaves the new owner's `lastTickFinishedAt` stale → its first owned tick runs a catch-up sweep. Intended: it covers exactly the dead-owner gap; idempotency comes from `botStatus` transitions (`pending → main_invited`), so a re-run cannot double-invite a task already moved.
- **Out of scope (deliberate):** Fireflies' own calendar auto-join interplay; alerting on `FIREFLIES_TICK_SKIPPED_RATELIMIT` rows (natural Timber/LogHub consumer later); per-task rate-limit budgeting.
