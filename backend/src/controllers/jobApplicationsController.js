/**
 * Per-candidate job-application state.
 *
 * Each row records that a recruiter / expert / admin has marked a
 * scraped job posting as "applied" (or moved through a status pipeline)
 * for a specific candidate. Lets the UI:
 *   - Show a green tick on rows the team already applied to
 *   - Filter out applied jobs from the active matching list
 *   - Track simple status (applied → interview → rejected | hired)
 *
 * Storage: collection `jobApplications` in the existing
 * `interviewSupport` database.
 *
 * Schema:
 *   {
 *     candidateId: string (ObjectId-as-string),
 *     jobId:       string (the Apify-side job id, used as dedup key),
 *     jobTitle:    string,
 *     company:     string,
 *     jobUrl:      string,
 *     status:      'applied' | 'interview' | 'rejected' | 'hired',
 *     appliedBy:   email of the user who first marked it,
 *     appliedAt:   Date,
 *     updatedAt:   Date,
 *   }
 *
 * Unique index on { candidateId: 1, jobId: 1 } so re-applying is an
 * idempotent upsert.
 */
import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const COL = 'jobApplications';
const VALID_STATUSES = new Set(['applied', 'interview', 'rejected', 'hired']);

let _indexEnsured = false;
async function ensureIndex(db) {
  if (_indexEnsured) return;
  const col = db.collection(COL);
  await col.createIndex({ candidateId: 1, jobId: 1 }, { unique: true });
  await col.createIndex({ candidateId: 1, updatedAt: -1 });
  _indexEnsured = true;
}

class JobApplicationsController {
  list = asyncHandler(async (req, res) => {
    const { candidateId, status } = req.query;
    if (!candidateId) {
      return res.status(400).json({ success: false, error: 'candidateId is required' });
    }
    const db = database.getDb();
    await ensureIndex(db);
    const filter = { candidateId: String(candidateId) };
    if (status && VALID_STATUSES.has(String(status))) filter.status = String(status);

    const docs = await db
      .collection(COL)
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(500)
      .toArray();

    return res.json({
      success: true,
      candidateId,
      count: docs.length,
      // Compact list of jobIds for quick frontend Set lookups.
      appliedJobIds: docs.map((d) => d.jobId),
      applications: docs.map((d) => ({
        id: d._id.toString(),
        jobId: d.jobId,
        jobTitle: d.jobTitle,
        company: d.company,
        jobUrl: d.jobUrl,
        status: d.status,
        appliedBy: d.appliedBy,
        appliedAt: d.appliedAt,
        updatedAt: d.updatedAt,
      })),
    });
  });

  upsert = asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

    const {
      candidateId,
      jobId,
      jobTitle = '',
      company = '',
      jobUrl = '',
      status = 'applied',
    } = req.body || {};

    if (!candidateId || !jobId) {
      return res.status(400).json({ success: false, error: 'candidateId and jobId are required' });
    }
    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({
        success: false,
        error: `status must be one of: ${[...VALID_STATUSES].join(', ')}`,
      });
    }

    const db = database.getDb();
    await ensureIndex(db);
    const now = new Date();

    const filter = { candidateId: String(candidateId), jobId: String(jobId) };
    const update = {
      $setOnInsert: {
        candidateId: String(candidateId),
        jobId:       String(jobId),
        appliedBy:   user.email,
        appliedAt:   now,
      },
      $set: {
        jobTitle:  String(jobTitle).slice(0, 500),
        company:   String(company).slice(0, 200),
        jobUrl:    String(jobUrl).slice(0, 1000),
        status,
        updatedAt: now,
      },
    };

    const result = await db.collection(COL).findOneAndUpdate(filter, update, {
      upsert: true,
      returnDocument: 'after',
    });

    const doc = result?.value || (await db.collection(COL).findOne(filter));
    return res.status(201).json({
      success: true,
      application: {
        id: doc._id.toString(),
        jobId: doc.jobId,
        jobTitle: doc.jobTitle,
        company: doc.company,
        jobUrl: doc.jobUrl,
        status: doc.status,
        appliedBy: doc.appliedBy,
        appliedAt: doc.appliedAt,
        updatedAt: doc.updatedAt,
      },
    });
  });

  remove = asyncHandler(async (req, res) => {
    const { candidateId, jobId } = req.body || {};
    if (!candidateId || !jobId) {
      return res.status(400).json({ success: false, error: 'candidateId and jobId are required' });
    }
    const db = database.getDb();
    const r = await db.collection(COL).deleteOne({
      candidateId: String(candidateId),
      jobId: String(jobId),
    });
    return res.json({ success: true, deleted: r.deletedCount || 0 });
  });

  updateStatus = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({
        success: false,
        error: `status must be one of: ${[...VALID_STATUSES].join(', ')}`,
      });
    }
    const db = database.getDb();
    const r = await db.collection(COL).findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { status, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!r?.value) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({
      success: true,
      application: {
        id: r.value._id.toString(),
        ...r.value,
      },
    });
  });
}

export const jobApplicationsController = new JobApplicationsController();
