import { logger } from '../utils/logger.js';
import { database } from '../config/database.js';

export async function ensurePerformanceIndexes() {
  try {
    const db = database.getDb();

    // ── taskBody indexes ──
    await db.collection('taskBody').createIndex({ receivedDateTime: -1 });
    await db.collection('taskBody').createIndex({ status: 1, receivedDateTime: -1 });
    await db.collection('taskBody').createIndex({ assignedTo: 1, receivedDateTime: -1 });
    await db.collection('taskBody').createIndex({ subject: 1 });
    await db.collection('taskBody').createIndex({ 'Candidate Name': 1 });

    // ── candidateDetails indexes ──
    await db.collection('candidateDetails').createIndex({ status: 1 });
    await db.collection('candidateDetails').createIndex({ Recruiter: 1 });
    await db.collection('candidateDetails').createIndex({ Expert: 1 });
    await db.collection('candidateDetails').createIndex({ Branch: 1 });
    await db.collection('candidateDetails').createIndex({ updated_at: -1 });
    // Used by jobsPoolService active-candidate snapshot + missing-resume
    // popup. Compound on status keeps the Active filter index-resident.
    await db.collection('candidateDetails').createIndex(
      { status: 1, 'forgeProfile.titles': 1 },
      { name: 'status_forge_titles' }
    );
    await db.collection('candidateDetails').createIndex({ 'Candidate Name': 1 });
    await db.collection('candidateDetails').createIndex({ 'Email ID': 1 });
    await db.collection('candidateDetails').createIndex({ Recruiter: 1, status: 1 });
    await db.collection('candidateDetails').createIndex({ Branch: 1, status: 1 });

    // ── auditLog index (interview support admin) ──
    await db.collection('auditLog').createIndex({ subject: 1, timestamp: 1 });
    await db.collection('auditLog').createIndex({ phase: 1, timestamp: -1 });

    // ── perfMetrics TTL (don't keep forever) ──
    await db.collection('perfMetrics').createIndex({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

    logger.info('✅ Performance indexes ensured');
  } catch (err) {
    logger.warn('⚠️ ensurePerformanceIndexes failed (non-fatal)', { error: err.message });
  }
}
