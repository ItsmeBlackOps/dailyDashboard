# Task heavy-field projection (drop `replies` + `body` where unused) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop fetching the heavy `replies` (email thread) and `body` (HTML) fields from `taskBody` at every read-site that never uses them, keeping them only in the one detail view that does.

**Architecture:** One exported constant `TASK_EXCLUDE_HEAVY = { replies: 0, body: 0 }` in the Task model, applied as a Mongo projection (or aggregation `$project`) at the 8 read-sites the audit proved never read those fields. The single consumer that needs them (`interviewSupportAdminService.getTaskDetail`) is left untouched. Part A (PR #180) already removed the only other `body` consumer (the Fireflies body-scrape), so the scheduler now drops both too.

**Tech Stack:** Node ESM, Express 5, raw MongoDB driver, Jest (`node --experimental-vm-modules`).

**`taskBody` scale:** 19,579 docs, ~10 KB avg/doc — `replies`+`body` are the bulk. Dropping them shrinks per-action single-doc reads (e.g. `markMeetingStarted`, every toggle) and multi-doc admin/hierarchy reads.

---

## Audit result (what each site does today)

| Site (file:line) | Call | Reads replies/body? | Action |
|---|---|---|---|
| `models/Task.js` | — | — | **add** `TASK_EXCLUDE_HEAVY` |
| `controllers/taskController.js:329` `markMeetingStarted` | `findOne({_id})` | no | projection |
| `controllers/taskController.js:291` `updateMeetingLink` | `findOneAndUpdate(...,{returnDocument:'after'})` | no | projection in options |
| `services/interviewSupportAdminService.js:36` `listTasks` | `col.find(query)` | no | projection |
| `services/interviewSupportAdminService.js:77` `updateTaskStatus` | `findOne({_id})` | no | projection |
| `services/interviewSupportAdminService.js:115` `retryAutoAssign` | `findOne({_id})` | no | projection |
| `services/interviewSupportAdminService.js:171` `manualTriggerAutoAssign` | `findOne({_id})` | no | projection |
| `services/interviewSupportAdminService.js:~492` `enrichFailedAutoAssigns` | `taskCol.find({subject…})` | no | projection |
| `controllers/dashboardController.js:848` `getCandidateHierarchy` | simple `$lookup` from `taskBody` | no | pipeline `$lookup` + `$project` |
| `jobs/firefliesBotScheduler.js:~363` `tick` | `.find({$and…})` (no projection) | no (after PR #180) | projection |
| `services/interviewSupportAdminService.js:56` `getTaskDetail` | `findOne({_id})` | **YES** | **KEEP — no change** |

> ⚠ Lines 56, 77, 115, 171 are the **identical** string `const task = await taskCol.findOne({ _id: oid });`. Do **not** use replace-all — anchor each edit with the line(s) that follow it (shown per task). Line 56 (`getTaskDetail`) must stay unchanged.

---

### Task 1: Add the `TASK_EXCLUDE_HEAVY` constant

**Files:**
- Modify: `backend/src/models/Task.js` (top of file, after the imports)
- Test: `backend/test/task.excludeHeavy.test.js` (create)

- [ ] **Step 1: Write the failing test**

```js
// backend/test/task.excludeHeavy.test.js
import { describe, it, expect } from '@jest/globals';
import { TASK_EXCLUDE_HEAVY } from '../src/models/Task.js';

describe('TASK_EXCLUDE_HEAVY', () => {
  it('is a pure exclusion projection for the two heavy fields', () => {
    expect(TASK_EXCLUDE_HEAVY).toEqual({ replies: 0, body: 0 });
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`TASK_EXCLUDE_HEAVY` is not exported yet)

```
cd backend && NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules npx jest task.excludeHeavy
```
Expected: FAIL — `TASK_EXCLUDE_HEAVY` is undefined.

- [ ] **Step 3: Add the export.** In `backend/src/models/Task.js`, immediately after the import lines at the top, add:

```js
// Heavy fields on taskBody (the email thread + HTML body, ~the bulk of a
// ~10 KB doc). Exclude from any read that does not render them. The ONLY
// consumer that needs them is interviewSupportAdminService.getTaskDetail.
export const TASK_EXCLUDE_HEAVY = { replies: 0, body: 0 };
```

- [ ] **Step 4: Run it — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git add backend/src/models/Task.js backend/test/task.excludeHeavy.test.js
git commit -m "perf(tasks): add TASK_EXCLUDE_HEAVY projection constant"
```

---

### Task 2: `markMeetingStarted` projection

**Files:**
- Modify: `backend/src/controllers/taskController.js` (import + the `findOne` at ~329)
- Test: `backend/test/taskController.markMeetingStarted.test.js` (extend — exists)

- [ ] **Step 1: Add the failing assertion** to the existing suite (the file mocks `database.getCollection` → `{ findOne: mockFindOne, updateOne: mockUpdateOne }`). Add inside `describe('taskController.markMeetingStarted')`:

```js
  it('reads the task without the heavy replies/body fields', async () => {
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'exp@x.com' });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'exp@x.com', role: 'user' } }), r);
    expect(mockFindOne.mock.calls[0][1]).toEqual({ projection: { replies: 0, body: 0 } });
  });
```

- [ ] **Step 2: Run — expect FAIL** (`mock.calls[0][1]` is `undefined` — no projection yet).

```
cd backend && NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules npx jest taskController.markMeetingStarted
```

- [ ] **Step 3: Implement.** In `taskController.js`, add the import near the existing `import { database } from '../config/database.js';`:

```js
import { TASK_EXCLUDE_HEAVY } from '../models/Task.js';
```

Then change the `markMeetingStarted` read (~line 329) from:

```js
    const task = await collection.findOne({ _id: new ObjectId(taskId) });
```
to:
```js
    const task = await collection.findOne({ _id: new ObjectId(taskId) }, { projection: TASK_EXCLUDE_HEAVY });
```

- [ ] **Step 4: Run — expect PASS** (this test + all existing `markMeetingStarted` tests stay green; the guard reads only `assignedTo`/`meetingStarted`/`interviewStartAt`/legacy schedule fields — none heavy).
- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/taskController.js backend/test/taskController.markMeetingStarted.test.js
git commit -m "perf(tasks): drop replies/body from markMeetingStarted read"
```

---

### Task 3: `updateMeetingLink` projection

**Files:**
- Modify: `backend/src/controllers/taskController.js` (the `findOneAndUpdate` at ~291)
- Test: `backend/test/taskController.updateMeetingLink.test.js` (extend — exists)

- [ ] **Step 1: Add the failing assertion.** The file mocks the collection with `findOneAndUpdate`. Add:

```js
  it('returns the updated doc without the heavy replies/body fields', async () => {
    // (reuse the suite's existing happy-path setup that calls updateMeetingLink)
    // After the call, assert the options arg carried the projection:
    expect(mockFindOneAndUpdate.mock.calls[0][2]).toEqual(
      expect.objectContaining({ projection: { replies: 0, body: 0 } })
    );
  });
```
> If the suite's mock variable isn't named `mockFindOneAndUpdate`, match the existing name. If there is no happy-path call in scope, wrap this in the suite's existing "valid update" test setup.

- [ ] **Step 2: Run — expect FAIL.**

```
cd backend && NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules npx jest taskController.updateMeetingLink
```

- [ ] **Step 3: Implement.** Change the options object (~line 294) from:

```js
      { returnDocument: 'after' }
```
to:
```js
      { returnDocument: 'after', projection: TASK_EXCLUDE_HEAVY }
```
(The `TASK_EXCLUDE_HEAVY` import was added in Task 2.)

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/taskController.js backend/test/taskController.updateMeetingLink.test.js
git commit -m "perf(tasks): drop replies/body from updateMeetingLink returned doc"
```

---

### Task 4: `interviewSupportAdminService` — 5 reads (keep `getTaskDetail`)

**Files:**
- Modify: `backend/src/services/interviewSupportAdminService.js`
- Test: `backend/test/interviewSupportAdmin.projection.test.js` (create)

- [ ] **Step 1: Write the failing test.** This service reads `database.getCollection('taskBody')` and `('auditLog')`. Mock both; assert the listed reads pass the projection and `getTaskDetail` does **not**.

```js
// backend/test/interviewSupportAdmin.projection.test.js
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockFind = jest.fn(() => ({ sort: () => ({ skip: () => ({ limit: () => ({ toArray: async () => [] }) }) }) }));
const mockFindOne = jest.fn(async () => ({ _id: 'x', Status: 'Pending', Subject: 's' }));
const mockCountDocuments = jest.fn(async () => 0);
const auditFind = jest.fn(() => ({ sort: () => ({ toArray: async () => [] }) }));
const mockGetCollection = jest.fn((name) => name === 'taskBody'
  ? { find: mockFind, findOne: mockFindOne, countDocuments: mockCountDocuments }
  : { find: auditFind, insertOne: jest.fn(), updateOne: jest.fn() });

jest.unstable_mockModule('../src/config/database.js', () => ({ database: { getCollection: mockGetCollection } }));
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const svc = await import('../src/services/interviewSupportAdminService.js');
const { TASK_EXCLUDE_HEAVY } = await import('../src/models/Task.js');
beforeEach(() => jest.clearAllMocks());

describe('interviewSupportAdminService — heavy-field projection', () => {
  it('listTasks passes the projection to find', async () => {
    await svc.interviewSupportAdminService.listTasks({});
    expect(mockFind.mock.calls[0][1]).toEqual({ projection: TASK_EXCLUDE_HEAVY });
  });

  it('getTaskDetail does NOT project (it needs replies + body)', async () => {
    await svc.interviewSupportAdminService.getTaskDetail('507f1f77bcf86cd799439011');
    // getTaskDetail's findOne is called with just the filter (no 2nd arg).
    const detailCall = mockFindOne.mock.calls.find(c => true);
    expect(detailCall[1]).toBeUndefined();
  });
});
```
> Adjust the exported accessor (`svc.interviewSupportAdminService` vs a default export) to match the file. If `listTasks` needs specific args to reach the `find`, pass minimal valid ones.

- [ ] **Step 2: Run — expect FAIL** (`listTasks` passes no projection yet).

```
cd backend && NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules npx jest interviewSupportAdmin.projection
```

- [ ] **Step 3: Implement.** Add the import at the top of `interviewSupportAdminService.js`:

```js
import { TASK_EXCLUDE_HEAVY } from '../models/Task.js';
```

Make these five edits (leave line 56 `getTaskDetail` untouched):

1. **listTasks (~line 36):**
```js
      col.find(query).sort({ _id: -1 }).skip(skip).limit(limitNum).toArray(),
```
→
```js
      col.find(query, { projection: TASK_EXCLUDE_HEAVY }).sort({ _id: -1 }).skip(skip).limit(limitNum).toArray(),
```

2. **updateTaskStatus (~line 77)** — anchor by the following lines (`const prevStatus`):
```js
    const task = await taskCol.findOne({ _id: oid });
    if (!task) throw new Error('Task not found');

    const prevStatus = task['Status'];
```
→
```js
    const task = await taskCol.findOne({ _id: oid }, { projection: TASK_EXCLUDE_HEAVY });
    if (!task) throw new Error('Task not found');

    const prevStatus = task['Status'];
```

3. **retryAutoAssign (~line 115)** — anchor by the following `const now = new Date();`:
```js
    const task = await taskCol.findOne({ _id: oid });
    if (!task) throw new Error('Task not found');

    const now = new Date();
```
→
```js
    const task = await taskCol.findOne({ _id: oid }, { projection: TASK_EXCLUDE_HEAVY });
    if (!task) throw new Error('Task not found');

    const now = new Date();
```

4. **manualTriggerAutoAssign (~line 171)** — anchor by the following `const subject = task['Subject']`:
```js
    const task = await taskCol.findOne({ _id: oid });
    if (!task) throw new Error('Task not found');

    const subject = task['Subject'] || task['subject'] || '';
```
→
```js
    const task = await taskCol.findOne({ _id: oid }, { projection: TASK_EXCLUDE_HEAVY });
    if (!task) throw new Error('Task not found');

    const subject = task['Subject'] || task['subject'] || '';
```

5. **enrichFailedAutoAssigns (~line 492)** — locate the `taskCol.find({ ... })` inside this method (the "Enrich by subject → most recent matching taskBody row" block) and add `{ projection: TASK_EXCLUDE_HEAVY }` as the second argument to that `find`. (It selects by subject and reads only `_id`/subject/assignment fields — never replies/body.)

- [ ] **Step 4: Run — expect PASS** (the projection test + nothing else broken).
- [ ] **Step 5: Commit**

```bash
git add backend/src/services/interviewSupportAdminService.js backend/test/interviewSupportAdmin.projection.test.js
git commit -m "perf(tasks): drop replies/body from interview-support-admin task reads (keep getTaskDetail)"
```

---

### Task 5: `dashboardController.getCandidateHierarchy` — pipeline `$lookup` + `$project`

**Files:**
- Modify: `backend/src/controllers/dashboardController.js` (the `$lookup` at ~848)

**Why no unit test:** this is a single stage inside a large inline aggregation with no existing harness; a brittle pipeline-shape assertion adds little. Verify via DB instead (Step 3).

- [ ] **Step 1: Add the import** at the top of `dashboardController.js`:

```js
import { TASK_EXCLUDE_HEAVY } from '../models/Task.js';
```

- [ ] **Step 2: Convert the simple `$lookup` to the pipeline form** (~line 848). Replace:

```js
                    $lookup: {
                        from: 'taskBody',
                        localField: 'Email ID',
                        foreignField: 'Email ID',
                        as: 'interviews'
                    }
```
with:
```js
                    $lookup: {
                        from: 'taskBody',
                        let: { emailId: '$Email ID' },
                        pipeline: [
                            { $match: { $expr: { $eq: ['$Email ID', '$$emailId'] } } },
                            { $project: TASK_EXCLUDE_HEAVY },
                        ],
                        as: 'interviews'
                    }
```
(The `interviews[]` array is used only for counting/filtering downstream — never reads `replies`/`body`.)

- [ ] **Step 3: Verify against the DB** (no live-Atlas unit test on this box). After deploy, fetch a hierarchy that has interviews and confirm the joined `interviews[]` elements no longer carry `replies`/`body`:

```
mongosh "$URI/interviewSupport" --quiet --eval '
const r = db.candidateDetails.aggregate([
  { $limit: 1 },
  { $lookup: { from: "taskBody", let: { e: "$Email ID" },
      pipeline: [ { $match: { $expr: { $eq: ["$Email ID", "$$e"] } } }, { $project: { replies:0, body:0 } } ],
      as: "interviews" } }
]).toArray();
print("interviews sample keys: " + JSON.stringify(Object.keys((r[0]?.interviews?.[0])||{})));
'
```
Expected: the printed keys do **not** include `replies` or `body`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/dashboardController.js
git commit -m "perf(tasks): drop replies/body from dashboard hierarchy taskBody lookup"
```

---

### Task 6: `firefliesBotScheduler.tick` projection

**Files:**
- Modify: `backend/src/jobs/firefliesBotScheduler.js` (the `.find({...})` at ~363, post-PR-#180)

**Why no unit test:** the scheduler tick has no harness (heavy external deps) and the change is a mechanical projection; the read uses only scheduling/status/link fields. Verify with `node --check`.

- [ ] **Step 1: Add the import** at the top of `firefliesBotScheduler.js`:

```js
import { TASK_EXCLUDE_HEAVY } from '../models/Task.js';
```

- [ ] **Step 2: Add the projection** to the candidate `find`. Change:

```js
    const candidates = await collection
      .find({
        $and: [
```
…(keep the whole filter unchanged)…
```js
        botStatus: { $nin: ['main_joined', 'main_failed', 'completed'] },
      })
      .sort({ interviewDateTime: 1 })
```
so the `find` gets a second argument — i.e. replace the closing `})` of the filter + the `.sort` with:
```js
        botStatus: { $nin: ['main_joined', 'main_failed', 'completed'] },
      }, { projection: TASK_EXCLUDE_HEAVY })
      .sort({ interviewDateTime: 1 })
```

- [ ] **Step 3: Verify syntax**

```
node --check backend/src/jobs/firefliesBotScheduler.js && echo OK
```
Expected: `OK`. (Scheduler reads only `_id`, `meetingLink`, `joinUrl`/`joinWebUrl`, `meetingPassword`, `botStatus`, `botInviteAttempts`, `interviewDateTime` + legacy date/time + `Candidate Name` — none heavy.)

- [ ] **Step 4: Commit**

```bash
git add backend/src/jobs/firefliesBotScheduler.js
git commit -m "perf(tasks): drop replies/body from fireflies scheduler candidate read"
```

---

### Task 7: Full verify + PR

- [ ] **Step 1: Run the affected suites** (DB-less; Atlas-dependent suites fail offline — that's pre-existing, diff against main):

```
cd backend && NODE_ENV=test NODE_OPTIONS=--experimental-vm-modules npx jest \
  task.excludeHeavy taskController.markMeetingStarted taskController.updateMeetingLink interviewSupportAdmin.projection
```
Expected: all PASS.

- [ ] **Step 2: Syntax-check the no-test files**

```
node --check backend/src/controllers/dashboardController.js && node --check backend/src/jobs/firefliesBotScheduler.js && echo OK
```

- [ ] **Step 3: Push branch + open PR** `perf(tasks): drop replies/body from task reads that never use them`. Body: link this plan + the audit table; note `getTaskDetail` is the sole consumer that keeps both; reference PR #180 (removed the scheduler's last `body` use). Plain commit/PR messages, no AI-attribution trailer.

- [ ] **Step 4: After deploy**, run the Task 5 DB verification and spot-check the admin task list still renders (it never showed replies/body).

---

## Self-review

- **Spec coverage:** every audit "drop" site has a task (Tasks 2–6); the constant has Task 1; `getTaskDetail` is explicitly kept (Task 4 asserts it). ✓
- **Type consistency:** one constant name `TASK_EXCLUDE_HEAVY` (= `{ replies: 0, body: 0 }`) used everywhere; same import path `../models/Task.js` from controllers/services/jobs. ✓
- **Placeholders:** the only non-literal locations (`enrichFailedAutoAssigns` find, the scheduler find boundary) are described with file + method + anchor; all other edits show exact before→after. ✓
- **Risk:** projection-only (+ one `$lookup`→pipeline conversion); no logic change. The audit proved none of these consumers read `replies`/`body`. The `$lookup` pipeline form preserves the `Email ID = Email ID` join.
