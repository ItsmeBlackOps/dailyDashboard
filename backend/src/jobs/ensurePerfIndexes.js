import { logger } from '../utils/logger.js';
import { database } from '../config/database.js';

// Every index this app relies on, in one declaration list. Each entry is
// applied independently — see applyIndexDeclarations below for why.
export const INDEX_DECLARATIONS = [
  // ── taskBody indexes ──
  { coll: 'taskBody', keys: { receivedDateTime: -1 } },
  { coll: 'taskBody', keys: { status: 1, receivedDateTime: -1 } },
  { coll: 'taskBody', keys: { assignedTo: 1, receivedDateTime: -1 } },
  { coll: 'taskBody', keys: { subject: 1 } },
  // NOTE: prod has a hand-created index on this key under the custom name
  // 'Candidate Name'. createIndex with the auto-name 'Candidate Name_1' then
  // fails with IndexOptionsConflict (code 85) — same keys, different name.
  // That single conflict is harmless (an equivalent index exists), but it MUST
  // NOT abort the declarations after it — which is exactly what happened until
  // 2026-06: one shared try/catch swallowed the error and silently skipped
  // every index below this line (interviewStartAt, the PRT/EAD set, the
  // perfMetrics TTL, ...). Per-declaration isolation guarantees one conflict
  // can never starve the rest again.
  { coll: 'taskBody', keys: { 'Candidate Name': 1 } },
  // SP3: native indexed Date range/sort on the canonical interview times
  // (interviewStartAt/interviewEndsAt are proper BSON Dates in UTC).
  { coll: 'taskBody', keys: { interviewStartAt: 1 } },
  { coll: 'taskBody', keys: { interviewEndsAt: 1 } },
  // SP3 perf-regression fix: getTasksByRange/search aggregates run with a
  // case-insensitive collation (for the candidate-name $lookup). Mongo only
  // uses a collation-MATCHED index, so the simple { interviewStartAt: 1 }
  // above is ignored under those aggregates → window scan + in-memory sort.
  // This collation-matched compound index serves both the interviewStartAt
  // range $match and the { interviewStartAt: 1, _id: -1 } $sort under collation.
  {
    coll: 'taskBody',
    keys: { interviewStartAt: 1, _id: -1 },
    opts: { collation: { locale: 'en', strength: 2 }, name: 'interviewStartAt_id_ci' }
  },

  // ── candidateDetails indexes ──
  { coll: 'candidateDetails', keys: { status: 1 } },
  { coll: 'candidateDetails', keys: { Recruiter: 1 } },
  { coll: 'candidateDetails', keys: { Expert: 1 } },
  { coll: 'candidateDetails', keys: { Branch: 1 } },
  { coll: 'candidateDetails', keys: { updated_at: -1 } },
  // Used by jobsPoolService active-candidate snapshot + missing-resume
  // popup. Compound on status keeps the Active filter index-resident.
  { coll: 'candidateDetails', keys: { status: 1, 'forgeProfile.titles': 1 }, opts: { name: 'status_forge_titles' } },
  { coll: 'candidateDetails', keys: { 'Candidate Name': 1 } },
  { coll: 'candidateDetails', keys: { 'Email ID': 1 } },
  // C-perf: case-insensitive collation index so getCandidateByEmail's
  // duplicate check is an index-served equality (not a /i-regex collection
  // scan). Distinct name — coexists with the simple { 'Email ID': 1 } index.
  {
    coll: 'candidateDetails',
    keys: { 'Email ID': 1 },
    opts: { collation: { locale: 'en', strength: 2 }, name: 'emailId_ci' }
  },
  { coll: 'candidateDetails', keys: { Recruiter: 1, status: 1 } },
  { coll: 'candidateDetails', keys: { Branch: 1, status: 1 } },

  // ── PRT Phase 4 indexes ──
  // Underpins the candidateAlertScheduler cursor + the "Expiring soon"
  // filter on the candidate list. The compound status+eadEndDate keeps
  // {Active,New} × <30d range queries index-resident.
  { coll: 'candidateDetails', keys: { visaType: 1 } },
  { coll: 'candidateDetails', keys: { eadEndDate: 1 } },
  { coll: 'candidateDetails', keys: { marketingStartDate: 1 } },
  { coll: 'candidateDetails', keys: { status: 1, eadEndDate: 1 } },
  { coll: 'candidateDetails', keys: { 'attachments.id': 1 } },

  // ── auditLog index (interview support admin) ──
  { coll: 'auditLog', keys: { subject: 1, timestamp: 1 } },
  { coll: 'auditLog', keys: { phase: 1, timestamp: -1 } },

  // ── perfMetrics TTL (don't keep forever) ──
  { coll: 'perfMetrics', keys: { createdAt: 1 }, opts: { expireAfterSeconds: 7 * 24 * 60 * 60 } }
];

// Applies every declaration, isolating failures per index: one conflict (e.g.
// IndexOptionsConflict against a legacy hand-named index) logs a warning and
// moves on instead of aborting the remaining declarations.
export async function applyIndexDeclarations(db, declarations = INDEX_DECLARATIONS) {
  let created = 0;
  let failed = 0;
  for (const { coll, keys, opts } of declarations) {
    try {
      await db.collection(coll).createIndex(keys, opts ?? {});
      created += 1;
    } catch (err) {
      failed += 1;
      logger.warn('index create failed (continuing)', {
        collection: coll,
        keys: JSON.stringify(keys),
        name: opts?.name,
        code: err.codeName ?? err.code,
        error: err.message
      });
    }
  }
  return { created, failed };
}

export async function ensurePerformanceIndexes() {
  try {
    const db = database.getDb();
    const { created, failed } = await applyIndexDeclarations(db);
    logger.info('✅ Performance indexes ensured', { created, failed });
  } catch (err) {
    logger.warn('⚠️ ensurePerformanceIndexes failed (non-fatal)', { error: err.message });
  }
}
