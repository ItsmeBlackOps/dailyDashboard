#!/usr/bin/env node
/**
 * Inspect a single interviewSupport.taskBody document by subject AND
 * print why the meeting link is empty (if it is).
 *
 * Usage:
 *   node backend/scripts/inspect-task-by-subject.js "Interview Support - Sai Sumanth Chaluvadi - Business Analyst - Apr 29, 2026 at 10:30 AM EST"
 *
 * Reads MONGODB_URI + DB_NAME from env (same as the running backend).
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';

const subjectArg = process.argv.slice(2).join(' ').trim();
if (!subjectArg) {
  console.error('Usage: node inspect-task-by-subject.js "<full subject>"');
  process.exit(2);
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || 'interviewSupport';
if (!uri) {
  console.error('MONGODB_URI not set');
  process.exit(2);
}

const MEETING_LINK_PATTERNS = [
  /https?:\/\/[a-z0-9.-]*zoom\.us\/[^\s<>"')]+/i,
  /https?:\/\/meet\.google\.com\/[a-z0-9-]+/i,
  /https?:\/\/teams\.microsoft\.com\/[^\s<>"')]+/i,
  /https?:\/\/teams\.live\.com\/[^\s<>"')]+/i,
  /https?:\/\/[a-z0-9.-]*webex\.com\/[^\s<>"')]+/i,
  /https?:\/\/[a-z0-9.-]*whereby\.com\/[^\s<>"')]+/i,
  /https?:\/\/[a-z0-9.-]*bluejeans\.com\/[^\s<>"')]+/i,
  /https?:\/\/[a-z0-9.-]*gotomeeting\.com\/[^\s<>"')]+/i,
];

function findMeetingLink(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.replace(/&amp;/g, '&').replace(/&#x?\d+;/g, '');
  for (const re of MEETING_LINK_PATTERNS) {
    const m = cleaned.match(re);
    if (m) return m[0].replace(/[.,);]+$/, '');
  }
  return null;
}

(async () => {
  const client = new MongoClient(uri, { maxPoolSize: 5 });
  try {
    await client.connect();
    const db = client.db(dbName);
    const tasks = db.collection('taskBody');
    const audits = db.collection('auditLog');

    const doc = await tasks.findOne({
      $or: [{ Subject: subjectArg }, { subject: subjectArg }],
    });

    if (!doc) {
      console.log('NO TASK FOUND for subject:');
      console.log(' ', subjectArg);
      process.exit(0);
    }

    console.log('═'.repeat(80));
    console.log('Task ID:               ', doc._id?.toString());
    console.log('Subject:               ', doc.Subject || doc.subject);
    console.log('Candidate Name:        ', doc['Candidate Name']);
    console.log('Status:                ', doc.Status || doc.status);
    console.log('meetingLink:           ', doc.meetingLink || '(empty)');
    console.log('joinUrl:               ', doc.joinUrl || '(empty)');
    console.log('joinWebUrl:            ', doc.joinWebUrl || '(empty)');
    console.log('meetingLinkAutoExtractedAt:', doc.meetingLinkAutoExtractedAt || '(never)');
    console.log('Replies count:         ', Array.isArray(doc.replies) ? doc.replies.length : 0);
    console.log('Body length:           ', (doc.body || '').length);

    console.log('\n── Body link probe ──────────────────────────────────────────');
    const bodyHit = findMeetingLink(doc.body);
    console.log(bodyHit ? `MATCH in body: ${bodyHit}` : 'No URL pattern in body');

    if (Array.isArray(doc.replies) && doc.replies.length > 0) {
      console.log('\n── Replies link probe (newest first) ────────────────────────');
      [...doc.replies].reverse().forEach((r, i) => {
        const hit = findMeetingLink(r?.body);
        console.log(
          `[${i}] receivedDateTime=${r?.receivedDateTime || '?'} from=${r?.from?.emailAddress?.address || r?.from || '?'}`
        );
        console.log(`    ${hit ? `MATCH: ${hit}` : 'No URL pattern'}`);
      });
    }

    const auditRows = await audits
      .find({ subject: doc.Subject || doc.subject })
      .sort({ createdAt: 1 })
      .toArray();
    console.log(`\n── Audit timeline (${auditRows.length} rows) ────────────────`);
    auditRows.forEach((r) => {
      console.log(
        `${r.createdAt?.toISOString?.() || r.createdAt}  ${(r.phase || r.action || '?').padEnd(22)}  ${r.detail || ''}`
      );
    });

    console.log('\n── Diagnosis ────────────────────────────────────────────────');
    if (doc.meetingLink) {
      console.log('Meeting link is set. No issue.');
    } else if (bodyHit) {
      console.log('Body has a URL but task.meetingLink is empty.');
      console.log('→ Fireflies scheduler should pick this up on next 60s tick.');
      console.log('→ If not picked up, check firefliesService.enabled and tick query.');
    } else {
      console.log('No URL anywhere in body. Possible causes:');
      console.log('  1. The interview email is the request template (no Zoom link).');
      console.log('  2. The link will be created by clicking "Create meeting" on the Tasks');
      console.log('     page, which now PATCHes /api/tasks/:id/meeting-link (PR #41).');
      console.log('  3. Or paste the link manually via the Task Sheet "Save & Invite Bot" form.');
    }
  } finally {
    await client.close();
  }
})().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
