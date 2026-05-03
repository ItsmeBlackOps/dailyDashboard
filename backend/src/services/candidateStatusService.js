/**
 * Canonical entry point for ALL status changes on candidateDetails.
 *
 * Every caller that wants to change `status` must go through this helper
 * (or the existing candidateService.updateCandidate which now forwards
 * the rich provenance fields). Direct collection writes bypass the audit
 * trail and will be flagged by the change-stream watcher (PR2).
 *
 * Why a separate helper:
 *  - Single place to enforce the rich statusHistory entry shape:
 *      { from, to, changedAt, changedBy, source, reason, sourceRef }
 *  - Idempotency on sourceRef.id (Intervue replays of the same Outlook
 *    messageId never write twice).
 *  - Optional poDate / Expert / placement updates piggyback on the same
 *    atomic write.
 */
import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const VALID_STATUSES = new Set([
  'Active', 'Hold', 'Backout', 'Low Priority', 'Placement Offer',
]);

const VALID_SOURCES = new Set([
  'manual-ui', 'po-email', 'fireflies-summary', 'admin-bulk', 'backfill', 'system',
]);

class CandidateStatusService {
  /**
   * Set candidate status atomically with a rich statusHistory entry.
   *
   * @param {object} opts
   * @param {string} opts.candidateId
   * @param {string} opts.newStatus       must be in VALID_STATUSES
   * @param {object} opts.ctx
   * @param {string} opts.ctx.changedBy   email or system tag
   * @param {string} opts.ctx.source      see VALID_SOURCES
   * @param {string} [opts.ctx.reason]
   * @param {object} [opts.ctx.sourceRef] { kind, id, ...metadata } — keying for idempotency
   * @param {Date}   [opts.ctx.changedAt] override default Date.now() (e.g. PO email's receivedDateTime)
   * @param {Date}   [opts.ctx.poDate]
   * @param {string} [opts.ctx.expert]    candidateDetails.Expert email
   * @param {object} [opts.ctx.placement] candidateDetails.placement payload
   */
  async setCandidateStatus({ candidateId, newStatus, ctx = {} }) {
    if (!candidateId) throw new Error('candidateId is required');
    if (!VALID_STATUSES.has(newStatus)) {
      throw new Error(`Invalid status "${newStatus}". Must be one of: ${[...VALID_STATUSES].join(', ')}`);
    }
    if (ctx.source && !VALID_SOURCES.has(ctx.source)) {
      throw new Error(`Invalid source "${ctx.source}". Must be one of: ${[...VALID_SOURCES].join(', ')}`);
    }

    const db = database.getDb();
    const col = db.collection('candidateDetails');
    let _id;
    try { _id = new ObjectId(candidateId); }
    catch { const e = new Error('Invalid candidateId'); e.statusCode = 400; throw e; }

    // Idempotency check — if sourceRef.id matches an existing entry, no-op.
    if (ctx.sourceRef?.id) {
      const dup = await col.findOne(
        { _id, 'statusHistory.sourceRef.id': ctx.sourceRef.id },
        { projection: { _id: 1 } }
      );
      if (dup) {
        return { skipped: true, reason: 'duplicate-sourceRef', sourceRefId: ctx.sourceRef.id };
      }
    }

    // Read prior state.
    const prior = await col.findOne({ _id }, {
      projection: { status: 1, poDate: 1, Expert: 1, 'Candidate Name': 1 }
    });
    if (!prior) {
      const e = new Error('Candidate not found');
      e.statusCode = 404; throw e;
    }

    const priorStatus = prior.status ?? null;
    const changedAt = ctx.changedAt instanceof Date ? ctx.changedAt : new Date();

    // No-op: status unchanged AND no piggyback fields are different.
    const fieldsChanging = (
      priorStatus !== newStatus ||
      (ctx.poDate !== undefined && this._dateNeq(prior.poDate, ctx.poDate)) ||
      (ctx.expert !== undefined && (prior.Expert || '').toLowerCase() !== ctx.expert.toLowerCase()) ||
      ctx.placement !== undefined
    );
    if (!fieldsChanging) {
      return { skipped: true, reason: 'no-op' };
    }

    const entry = {
      status:    newStatus,            // legacy field — same as `to`, kept for older readers
      from:      priorStatus,
      to:        newStatus,
      changedAt,
      changedBy: ctx.changedBy || 'system',
      source:    ctx.source || 'system',
      reason:    ctx.reason || null,
      sourceRef: ctx.sourceRef || null,
    };

    const setFields = { status: newStatus, updated_at: new Date() };
    if (ctx.poDate    !== undefined) setFields.poDate = ctx.poDate;
    if (ctx.expert    !== undefined) setFields.Expert = ctx.expert;
    if (ctx.placement !== undefined) setFields.placement = ctx.placement;

    await col.updateOne({ _id }, {
      $set: setFields,
      $push: { statusHistory: entry },
    });

    logger.info('candidate status changed', {
      candidateId,
      candidateName: prior['Candidate Name'],
      from: priorStatus,
      to: newStatus,
      source: ctx.source,
      changedBy: ctx.changedBy,
    });

    return { changed: true, from: priorStatus, to: newStatus, entry };
  }

  /**
   * Return the full statusHistory for a candidate, sorted oldest→newest.
   * Each entry includes both legacy and rich fields. Older entries that
   * were written before the schema upgrade have null `from`/`source`/etc.
   */
  async getStatusHistory(candidateId) {
    const db = database.getDb();
    const col = db.collection('candidateDetails');
    let _id;
    try { _id = new ObjectId(candidateId); }
    catch { const e = new Error('Invalid candidateId'); e.statusCode = 400; throw e; }

    const doc = await col.findOne({ _id }, {
      projection: { 'Candidate Name': 1, status: 1, poDate: 1, Expert: 1, statusHistory: 1 }
    });
    if (!doc) { const e = new Error('Candidate not found'); e.statusCode = 404; throw e; }

    const entries = (Array.isArray(doc.statusHistory) ? doc.statusHistory : [])
      .map((e) => ({
        status:    e.status ?? null,
        from:      e.from ?? null,
        to:        e.to ?? e.status ?? null,
        changedAt: e.changedAt instanceof Date ? e.changedAt.toISOString() : e.changedAt,
        changedBy: e.changedBy || 'system',
        source:    e.source ?? null,
        reason:    e.reason ?? null,
        sourceRef: e.sourceRef ?? null,
      }))
      .sort((a, b) => new Date(a.changedAt || 0) - new Date(b.changedAt || 0));

    return {
      candidateId,
      candidateName: doc['Candidate Name'] || '',
      currentStatus: doc.status ?? null,
      currentPoDate: doc.poDate instanceof Date ? doc.poDate.toISOString() : doc.poDate ?? null,
      currentExpert: doc.Expert || null,
      history: entries,
    };
  }

  _dateNeq(a, b) {
    if (a == null && b == null) return false;
    if (a == null || b == null) return true;
    const ad = a instanceof Date ? a : new Date(a);
    const bd = b instanceof Date ? b : new Date(b);
    return ad.getTime() !== bd.getTime();
  }
}

export const candidateStatusService = new CandidateStatusService();
export const _testInternals = { VALID_STATUSES, VALID_SOURCES };
