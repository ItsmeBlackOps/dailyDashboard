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
// Requires the same Azure env the app uses (config.azure) so the app-only
// Graph token can be acquired, and the app must have admin-consented app-only
// Calendars.ReadWrite (the report aborts with a clear message on 403).

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
<h2>Proposed for cancellation (KEEP stays, CANCEL goes)</h2>
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
    if (!organizerEmail) {
      ambiguous.push({ candidate, organizerEmail: '', interview, reason: 'no organizer email on task', matchCount: 0 });
      continue;
    }

    let events;
    try {
      events = await scanCalendar(token, organizerEmail, win);
    } catch (err) {
      if (String(err.message).startsWith('GRAPH_403')) throw err; // permission problem -> abort whole run
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
          keepJoinUrl: (result.keep.onlineMeeting && result.keep.onlineMeeting.joinUrl) || '',
          eventId: dup.id,
          subject: dup.subject,
          createdDateTime: dup.createdDateTime,
          joinUrl: (dup.onlineMeeting && dup.onlineMeeting.joinUrl) || '',
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
  console.log('Review the HTML, then to cancel:');
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
