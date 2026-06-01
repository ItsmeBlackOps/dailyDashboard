// PRT Phase 1 — backfill new candidate fields on `candidateDetails`.
// One-shot, idempotent. Safe to re-run.
//
// Run via:
//   MONGO_URI="<atlas-uri>" node backend/scripts/backfillPrtFields.mjs
//
// Behavior:
//   - DRY_RUN=true (default) prints the change set, no writes
//   - APPLY=true performs the writes inside a batched bulkWrite
//
// Per-doc behaviour (none of these is mandatory on existing docs):
//   - marketingStartDate ??= _last_write (or updated_at fallback)
//   - ackEmail ??= 'Pending'
//   - attachments[]      ??= []
//   - editHistory[]      ??= []
//   - assignmentEmails[] ??= []
//
// Out of scope: teamLead, experienceYears, visaType, eadStartDate,
// eadEndDate, company. These remain unset on historical docs and are
// only enforced on NEW edits via candidateService.sanitizeCandidatePayload.
//
// Status values are NOT touched — `Placement Offer` stays as-is.

import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'interviewSupport';
const APPLY = process.env.APPLY === 'true';
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 500);

if (!MONGO_URI) {
  console.error('MONGO_URI environment variable is required');
  process.exit(1);
}

const toDateOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const main = async () => {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  const candidates = db.collection('candidateDetails');

  const total = await candidates.countDocuments({});
  console.log(`[PRT backfill] DRY_RUN=${!APPLY} candidates=${total}`);

  const cursor = candidates.find({}, {
    projection: {
      _id: 1,
      _last_write: 1,
      updated_at: 1,
      marketingStartDate: 1,
      ackEmail: 1,
      attachments: 1,
      editHistory: 1,
      assignmentEmails: 1,
    }
  });

  const counters = {
    scanned: 0,
    set_marketingStartDate: 0,
    set_ackEmail: 0,
    init_attachments: 0,
    init_editHistory: 0,
    init_assignmentEmails: 0,
    no_change: 0,
    no_last_write: 0,
  };

  let bulkOps = [];
  const flush = async () => {
    if (bulkOps.length === 0) return;
    if (APPLY) {
      await candidates.bulkWrite(bulkOps, { ordered: false });
    }
    bulkOps = [];
  };

  for await (const doc of cursor) {
    counters.scanned += 1;
    const $set = {};

    if (doc.marketingStartDate === undefined || doc.marketingStartDate === null) {
      const fallback = toDateOrNull(doc._last_write) || toDateOrNull(doc.updated_at);
      if (fallback) {
        $set.marketingStartDate = fallback;
        counters.set_marketingStartDate += 1;
      } else {
        counters.no_last_write += 1;
      }
    }

    if (doc.ackEmail === undefined || doc.ackEmail === null || doc.ackEmail === '') {
      $set.ackEmail = 'Pending';
      counters.set_ackEmail += 1;
    }

    if (!Array.isArray(doc.attachments)) {
      $set.attachments = [];
      counters.init_attachments += 1;
    }
    if (!Array.isArray(doc.editHistory)) {
      $set.editHistory = [];
      counters.init_editHistory += 1;
    }
    if (!Array.isArray(doc.assignmentEmails)) {
      $set.assignmentEmails = [];
      counters.init_assignmentEmails += 1;
    }

    if (Object.keys($set).length === 0) {
      counters.no_change += 1;
      continue;
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set }
      }
    });

    if (bulkOps.length >= BATCH_SIZE) {
      await flush();
    }
  }
  await flush();

  console.log('[PRT backfill] summary:');
  for (const [k, v] of Object.entries(counters)) {
    console.log(`  ${k}: ${v}`);
  }

  if (!APPLY) {
    console.log('[PRT backfill] DRY_RUN — no writes performed. Re-run with APPLY=true.');
  } else {
    console.log('[PRT backfill] APPLY mode — writes complete.');
  }

  await client.close();
};

main().catch((err) => {
  console.error('[PRT backfill] failed:', err);
  process.exit(1);
});
