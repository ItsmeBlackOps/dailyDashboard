# Duplicate-Meeting Cleanup Script — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A safe, report-first one-off script that finds (and, on an explicit gated pass, cancels) the duplicate Teams meetings the old auto-create-on-reload bug created for upcoming interviews.

**Architecture:** A pure, unit-tested classifier (`classifyTaskMeetings`) decides which calendar events are duplicates to cancel vs. keep vs. ambiguous. A thin orchestration script connects to Mongo, scans each upcoming interview's organizer calendar via app-only Graph, runs the classifier, and writes a gitignored HTML+JSON report. A separate `--cancel` pass acts only on the reviewed JSON.

**Tech Stack:** Node ESM, MongoDB raw driver, `@azure/msal-node` (app-only token, reused via `graphMailService.acquireClientCredentialToken`), `moment-timezone`, Microsoft Graph (`calendarView`, `events/{id}/cancel`). Jest (ESM) for the classifier.

**Spec:** `docs/superpowers/specs/2026-06-02-duplicate-meeting-cleanup-design.md`

---

## File structure

- **Create** `backend/scripts/lib/classifyTaskMeetings.js` — pure classifier, no I/O. The unit of correctness.
- **Create** `backend/scripts/cleanupDuplicateMeetings.mjs` — orchestration: arg parsing, Mongo query, app-only token, calendar scan, report (HTML+JSON), and the gated cancel pass.
- **Create** `backend/test/classifyTaskMeetings.test.js` — classifier unit tests.
- **Modify** root `.gitignore` — add `backend/scripts/out/` (report output dir; PII, repo is public).

---

## Task 1: Pure classifier `classifyTaskMeetings`

**Files:**
- Create: `backend/scripts/lib/classifyTaskMeetings.js`
- Test: `backend/test/classifyTaskMeetings.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/test/classifyTaskMeetings.test.js`:

```javascript
import { describe, it, expect } from '@jest/globals';
import { classifyTaskMeetings } from '../scripts/lib/classifyTaskMeetings.js';

const TASK = { subject: 'Interview - Sravani', organizerEmail: 'Int@Co.com', persistedLink: 'https://teams/keep' };
const ev = (over = {}) => ({
  id: 'e',
  isOnlineMeeting: true,
  subject: 'Interview - Sravani',
  organizer: { emailAddress: { address: 'int@co.com' } },
  onlineMeeting: { joinUrl: 'https://teams/x' },
  ...over,
});

describe('classifyTaskMeetings', () => {
  it('none when there are no matching events', () => {
    expect(classifyTaskMeetings(TASK, []).status).toBe('none');
  });

  it('none when only one event matches', () => {
    const r = classifyTaskMeetings(TASK, [ev({ id: 'a' })]);
    expect(r.status).toBe('none');
    expect(r.keep.id).toBe('a');
  });

  it('flags duplicates and keeps the event matching the persisted link (case-insensitive organizer)', () => {
    const keep = ev({ id: 'keep', onlineMeeting: { joinUrl: 'https://teams/keep' } });
    const dup = ev({ id: 'dup', onlineMeeting: { joinUrl: 'https://teams/dup' } });
    const r = classifyTaskMeetings(TASK, [dup, keep]);
    expect(r.status).toBe('duplicates');
    expect(r.keep.id).toBe('keep');
    expect(r.duplicates.map((e) => e.id)).toEqual(['dup']);
  });

  it('ambiguous (cancels nothing) when no event matches the persisted link', () => {
    const r = classifyTaskMeetings(TASK, [
      ev({ id: 'a', onlineMeeting: { joinUrl: 'https://teams/x' } }),
      ev({ id: 'b', onlineMeeting: { joinUrl: 'https://teams/y' } }),
    ]);
    expect(r.status).toBe('ambiguous');
    expect(r.duplicates).toEqual([]);
  });

  it('excludes non-online, wrong-organizer, and wrong-subject events from matching', () => {
    const keep = ev({ id: 'keep', onlineMeeting: { joinUrl: 'https://teams/keep' } });
    const dup = ev({ id: 'dup', onlineMeeting: { joinUrl: 'https://teams/dup' } });
    const notOnline = ev({ id: 'no', isOnlineMeeting: false });
    const otherOrg = ev({ id: 'oo', organizer: { emailAddress: { address: 'someone@else.com' } } });
    const otherSubj = ev({ id: 'os', subject: 'Different' });
    const r = classifyTaskMeetings(TASK, [keep, dup, notOnline, otherOrg, otherSubj]);
    expect(r.status).toBe('duplicates');
    expect(r.keep.id).toBe('keep');
    expect(r.duplicates.map((e) => e.id)).toEqual(['dup']);
  });

  it('never includes the kept event in duplicates', () => {
    const keep = ev({ id: 'keep', onlineMeeting: { joinUrl: 'https://teams/keep' } });
    const dup = ev({ id: 'dup', onlineMeeting: { joinUrl: 'https://teams/dup' } });
    const r = classifyTaskMeetings(TASK, [keep, dup]);
    expect(r.duplicates).not.toContain(keep);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest test/classifyTaskMeetings.test.js`
Expected: FAIL — cannot find module `../scripts/lib/classifyTaskMeetings.js`.

- [ ] **Step 3: Implement the classifier**

Create `backend/scripts/lib/classifyTaskMeetings.js`:

```javascript
// Pure classifier for the duplicate-meeting cleanup script. No I/O.
// Given a normalized task and the organizer's calendar events within the
// interview window, decide which events are duplicate meetings to cancel,
// keeping the one whose join URL matches the task's persisted link.

function norm(value) {
  return value == null ? '' : String(value).trim();
}
function lc(value) {
  return norm(value).toLowerCase();
}
function joinUrlOf(ev) {
  return norm(ev && ev.onlineMeeting && ev.onlineMeeting.joinUrl);
}

export function classifyTaskMeetings(task, events) {
  const subject = norm(task && task.subject);
  const organizerEmail = lc(task && task.organizerEmail);
  const persistedLink = norm(task && task.persistedLink);
  const list = Array.isArray(events) ? events : [];

  // Strict match: the old createOutlookEvent set subject from the task, made
  // an online meeting, and the assigned interviewer was the organizer.
  const matches = list.filter((ev) =>
    ev &&
    ev.isOnlineMeeting === true &&
    lc(ev.organizer && ev.organizer.emailAddress && ev.organizer.emailAddress.address) === organizerEmail &&
    norm(ev.subject) === subject
  );

  if (matches.length <= 1) {
    return { status: 'none', keep: matches[0] || null, duplicates: [], matchCount: matches.length };
  }

  const canonical = persistedLink
    ? matches.filter((ev) => joinUrlOf(ev) === persistedLink)
    : [];

  if (canonical.length === 1) {
    const keep = canonical[0];
    return {
      status: 'duplicates',
      keep,
      duplicates: matches.filter((ev) => ev !== keep),
      matchCount: matches.length,
    };
  }

  return {
    status: 'ambiguous',
    keep: null,
    duplicates: [],
    matchCount: matches.length,
    reason: canonical.length === 0
      ? 'no calendar event matches the task persisted join link'
      : 'multiple events match the persisted link',
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest test/classifyTaskMeetings.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/lib/classifyTaskMeetings.js backend/test/classifyTaskMeetings.test.js
git commit -m "feat(cleanup): pure classifier for duplicate interview meetings"
```

---

## Task 2: Orchestration script (report + gated cancel)

**Files:**
- Create: `backend/scripts/cleanupDuplicateMeetings.mjs`
- Modify: `.gitignore` (repo root)

- [ ] **Step 1: Verify Graph endpoints via Context7 (CLAUDE.md mandate)**

`mcp__context7__resolve-library-id` "Microsoft Graph", then `mcp__context7__query-docs` for: "calendarView startDateTime endDateTime", and "cancel event POST /users/{id}/events/{id}/cancel comment". Confirm: `GET /users/{id}/calendarView?startDateTime=&endDateTime=` returns events in the window with `isOnlineMeeting`/`onlineMeeting`/`organizer`; and `POST /users/{id}/events/{id}/cancel` (organizer-only, body `{comment}`) cancels and notifies attendees, with `DELETE /users/{id}/events/{id}` as the fallback. Adjust the code below only if the docs differ.

- [ ] **Step 2: Add the output dir to `.gitignore`**

Append to the repo-root `.gitignore` (verify it isn't already covered):

```
# Duplicate-meeting cleanup reports (contain PII; repo is public)
backend/scripts/out/
```

- [ ] **Step 3: Create the script**

Create `backend/scripts/cleanupDuplicateMeetings.mjs`:

```javascript
#!/usr/bin/env node
// One-off: find & (optionally) cancel duplicate Teams meetings created by the
// pre-#152/#153 auto-create-on-reload bug, for UPCOMING interviews only.
//
// Report (read-only, default) — writes HTML + JSON to backend/scripts/out/:
//   MONGO_URI="<atlas-uri>" node backend/scripts/cleanupDuplicateMeetings.mjs
//
// Cancel (destructive, explicit) — acts ONLY on the reviewed JSON:
//   MONGO_URI="<atlas-uri>" node backend/scripts/cleanupDuplicateMeetings.mjs \
//     --cancel --from backend/scripts/out/duplicates-<stamp>.json --yes
//
// Requires the same Azure env the app uses (AZURE_* / config.azure) so the
// app-only Graph token can be acquired, and the app must have admin-consented
// app-only Calendars.ReadWrite (the report aborts with a clear message on 403).

import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import moment from 'moment-timezone';
import { graphMailService } from '../src/services/graphMailService.js';
import { classifyTaskMeetings } from './lib/classifyTaskMeetings.js';

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'interviewSupport';
const OUT_DIR = path.resolve(process.cwd(), 'backend/scripts/out');
const TZ = 'America/New_York';
const TIME_FORMATS = ['MM/DD/YYYY h:mm A', 'MM/DD/YYYY hh:mm A', 'MM/DD/YYYY HH:mm a'];
const GRAPH = 'https://graph.microsoft.com/v1.0';

function parseArgs(argv) {
  const args = { cancel: false, from: null, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--cancel') args.cancel = true;
    else if (argv[i] === '--from') { args.from = argv[i + 1]; i += 1; }
    else if (argv[i] === '--yes') args.yes = true;
  }
  return args;
}

function interviewWindow(task) {
  const date = task['Date of Interview'];
  const start = moment.tz(`${date} ${task['Start Time Of Interview']}`, TIME_FORMATS, true, TZ);
  const end = moment.tz(`${date} ${task['End Time Of Interview']}`, TIME_FORMATS, true, TZ);
  if (!start.isValid() || !end.isValid()) return null;
  return { start, end };
}

function persistedLinkOf(task) {
  return (task.meetingLink || task.joinUrl || task.joinWebUrl || '').toString().trim();
}
function organizerEmailOf(task) {
  return (task.assignedToEmail || task.assignedTo || '').toString().trim().toLowerCase();
}
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function graphGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  if (res.status === 403) {
    throw new Error(`GRAPH_403: ${url} — the app likely lacks app-only Calendars.ReadWrite. Grant + admin-consent it, then retry.`);
  }
  if (!res.ok) throw new Error(`Graph GET ${url} failed: ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function scanCalendar(token, email, win) {
  const startIso = win.start.clone().subtract(15, 'minutes').toISOString();
  const endIso = win.end.clone().add(15, 'minutes').toISOString();
  const url = `${GRAPH}/users/${encodeURIComponent(email)}/calendarView`
    + `?startDateTime=${encodeURIComponent(startIso)}&endDateTime=${encodeURIComponent(endIso)}`
    + `&$select=id,subject,isOnlineMeeting,onlineMeeting,organizer,start,end,createdDateTime&$top=100`;
  const data = await graphGet(url, token);
  return Array.isArray(data.value) ? data.value : [];
}

function buildHtml({ confirmed, ambiguous }) {
  const rows = confirmed.map((c) => `<tr>
    <td>${esc(c.candidate)}</td><td>${esc(c.organizerEmail)}</td><td>${esc(c.interview)}</td>
    <td>${esc(c.keepEventId)}<br><small>${esc(c.keepJoinUrl)}</small></td>
    <td>${esc(c.eventId)}<br><small>${esc(c.joinUrl)}</small><br><small>created ${esc(c.createdDateTime)}</small></td>
  </tr>`).join('\n');
  const amb = ambiguous.map((a) => `<tr><td>${esc(a.candidate)}</td><td>${esc(a.organizerEmail)}</td><td>${esc(a.interview)}</td><td colspan="2">${esc(a.reason)} (matched ${esc(a.matchCount)})</td></tr>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Duplicate meetings report</title>
<style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top}h2{margin-top:28px}</style>
<h1>Duplicate interview meetings — review</h1>
<p>${confirmed.length} duplicate event(s) proposed for cancellation. ${ambiguous.length} ambiguous (NOT auto-cancelled).</p>
<h2>Proposed for cancellation (keep column stays, cancel column goes)</h2>
<table><tr><th>Candidate</th><th>Organizer</th><th>Interview</th><th>KEEP</th><th>CANCEL</th></tr>${rows}</table>
<h2>Ambiguous — needs manual review</h2>
<table><tr><th>Candidate</th><th>Organizer</th><th>Interview</th><th>Reason</th><th></th></tr>${amb}</table>`;
}

async function runReport(db, token) {
  const todayStart = moment.tz(TZ).startOf('day');
  const tasks = await db.collection('taskBody').find({
    $or: [
      { meetingLink: { $nin: [null, ''] } },
      { joinUrl: { $nin: [null, ''] } },
      { joinWebUrl: { $nin: [null, ''] } },
    ],
  }).toArray();

  const confirmed = [];
  const ambiguous = [];

  for (const task of tasks) {
    const win = interviewWindow(task);
    if (!win || win.start.isBefore(todayStart)) continue; // upcoming only
    const organizerEmail = organizerEmailOf(task);
    const persistedLink = persistedLinkOf(task);
    const subject = (task.subject || `Interview for ${task['Candidate Name'] || 'candidate'}`).toString();
    const interview = win.start.format('YYYY-MM-DD HH:mm z');
    const candidate = task['Candidate Name'] || '';
    if (!organizerEmail) { ambiguous.push({ candidate, organizerEmail: '', interview, reason: 'no organizer email on task', matchCount: 0 }); continue; }

    let events;
    try {
      events = await scanCalendar(token, organizerEmail, win);
    } catch (err) {
      if (String(err.message).startsWith('GRAPH_403')) throw err; // permission problem → abort whole run
      ambiguous.push({ candidate, organizerEmail, interview, reason: `calendar scan failed: ${err.message}`, matchCount: 0 });
      continue;
    }

    const result = classifyTaskMeetings({ subject, organizerEmail, persistedLink }, events);
    if (result.status === 'duplicates') {
      for (const dup of result.duplicates) {
        confirmed.push({
          taskId: String(task._id),
          candidate,
          organizerEmail,
          interview,
          keepEventId: result.keep.id,
          keepJoinUrl: result.keep.onlineMeeting && result.keep.onlineMeeting.joinUrl || '',
          eventId: dup.id,
          subject: dup.subject,
          createdDateTime: dup.createdDateTime,
          joinUrl: dup.onlineMeeting && dup.onlineMeeting.joinUrl || '',
        });
      }
    } else if (result.status === 'ambiguous') {
      ambiguous.push({ candidate, organizerEmail, interview, reason: result.reason, matchCount: result.matchCount });
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = moment.tz(TZ).format('YYYYMMDD-HHmmss');
  const jsonPath = path.join(OUT_DIR, `duplicates-${stamp}.json`);
  const htmlPath = path.join(OUT_DIR, `duplicates-${stamp}.html`);
  fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), confirmed }, null, 2));
  fs.writeFileSync(htmlPath, buildHtml({ confirmed, ambiguous }));

  console.log(`Report: ${confirmed.length} duplicate event(s); ${ambiguous.length} ambiguous (manual review).`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  HTML: ${htmlPath}`);
  console.log(`Review the HTML, then to cancel:`);
  console.log(`  node backend/scripts/cleanupDuplicateMeetings.mjs --cancel --from ${jsonPath} --yes`);
}

async function runCancel(token, fromPath) {
  const payload = JSON.parse(fs.readFileSync(fromPath, 'utf8'));
  const items = Array.isArray(payload.confirmed) ? payload.confirmed : [];
  let cancelled = 0; let skipped = 0; let failed = 0;
  for (const it of items) {
    const base = `${GRAPH}/users/${encodeURIComponent(it.organizerEmail)}/events/${encodeURIComponent(it.eventId)}`;
    try {
      const res = await fetch(`${base}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: 'Cancelling a duplicate interview meeting created in error.' }),
      });
      if (res.status === 404) { skipped += 1; console.log(`skip (already gone): ${it.eventId}`); continue; }
      if (!res.ok) {
        const del = await fetch(base, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
        if (del.status === 404) { skipped += 1; continue; }
        if (!del.ok) { failed += 1; console.error(`FAILED ${it.eventId}: cancel ${res.status}, delete ${del.status}`); continue; }
      }
      cancelled += 1;
      console.log(`cancelled ${it.eventId} (task ${it.taskId}, ${it.candidate})`);
    } catch (err) {
      failed += 1;
      console.error(`ERROR ${it.eventId}: ${err.message}`);
    }
  }
  console.log(`Cancel complete: ${cancelled} cancelled, ${skipped} already gone, ${failed} failed.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.cancel && (!args.from || !args.yes)) {
    console.error('Refusing to cancel: --cancel requires both --from <report.json> and --yes.');
    process.exit(1);
  }
  const token = await graphMailService.acquireClientCredentialToken();

  if (args.cancel) {
    await runCancel(token, args.from);
    return;
  }

  if (!MONGO_URI) { console.error('MONGO_URI environment variable is required for the report.'); process.exit(1); }
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  try {
    await runReport(client.db(DB_NAME), token);
  } finally {
    await client.close();
  }
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
```

- [ ] **Step 4: Syntax-check + confirm the report dir is ignored**

Run:
```bash
cd backend && node --check scripts/cleanupDuplicateMeetings.mjs && node --check scripts/lib/classifyTaskMeetings.js
cd .. && mkdir -p backend/scripts/out && echo x > backend/scripts/out/_probe.txt && git check-ignore backend/scripts/out/_probe.txt && rm backend/scripts/out/_probe.txt
```
Expected: both `node --check` print nothing; `git check-ignore` echoes the probe path (proving it's ignored).

- [ ] **Step 5: Confirm the cancel-mode safety guard (no DB, no network needed)**

Run: `node backend/scripts/cleanupDuplicateMeetings.mjs --cancel` (omit `--from`/`--yes`)
Expected: prints `Refusing to cancel: --cancel requires both --from <report.json> and --yes.` and exits non-zero. (It exits before acquiring a token because the guard runs first.) NOTE: if `config.azure` isn't set in your shell this still must print the refusal and exit 1 — the guard precedes the token call.

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/cleanupDuplicateMeetings.mjs .gitignore
git commit -m "feat(cleanup): report-first duplicate-meeting cleanup script + gated cancel"
```

---

## Task 3: Verify + PR

- [ ] **Step 1: Run the classifier suite + confirm nothing else broke**

Run: `cd backend && NODE_OPTIONS=--experimental-vm-modules npx jest test/classifyTaskMeetings.test.js`
Expected: 6 pass.

- [ ] **Step 2: Confirm no report/PII file is staged**

Run: `git status --porcelain backend/scripts/out/` → expected: empty (nothing tracked under it).

- [ ] **Step 3: Push + open PR**

```bash
git push -u origin chore/cleanup-duplicate-meetings
gh pr create --base main --title "chore(meetings): report-first cleanup script for duplicate interview meetings" --body "<summary referencing docs/superpowers/specs/2026-06-02-duplicate-meeting-cleanup-design.md; note: report-only by default, cancel is gated; app-only Calendars.ReadWrite required at run time>"
```

- [ ] **Step 4: Watch CI to green, then report.** Do NOT merge without explicit user approval. The script is operator-run (not wired into the app), so there is no runtime behavior change to deploy.

---

## Self-review notes

- **Spec coverage:** pure classifier + strict match (Task 1); report mode scans upcoming-only organizer calendars via app-only token, writes gitignored HTML+JSON, 403-fast-fail (Task 2 runReport/scanCalendar); cancel mode acts only on the JSON, requires `--cancel --from --yes`, idempotent on 404 (Task 2 runCancel/guard); PII output gitignored (Task 2 step 2). All covered.
- **No placeholders:** every step has complete code/commands. The PR `--body` is a human-authored summary at PR time.
- **Type/name consistency:** classifier returns `{ status:'none'|'duplicates'|'ambiguous', keep, duplicates, matchCount, reason? }`; the script reads `result.status`, `result.keep`, `result.duplicates`, `result.reason`, `result.matchCount` — consistent. `acquireClientCredentialToken()` returns the token string (verified). JSON shape `{ confirmed: [{ organizerEmail, eventId, taskId, ... }] }` is written by runReport and read by runCancel — consistent.
- **Safety:** report-only default; cancel triple-gated; canonical/ambiguous never cancelled; PII gitignored; fail-fast on missing calendar permission.
