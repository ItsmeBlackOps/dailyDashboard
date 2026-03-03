import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const COLLECTION = 'transcriptRequests';
const STATUS = {
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected'
};

const toNormalizedEmail = (value = '') => value.toString().trim().toLowerCase();

const mapDocument = (doc) => {
  if (!doc) return null;
  return {
    id: doc._id?.toString?.() ?? String(doc._id),
    taskId: doc.taskId || '',
    taskSubject: doc.taskSubject || '',
    transcriptTitle: doc.transcriptTitle || '',
    candidateName: doc.candidateName || '',
    interviewDate: doc.interviewDate || '',
    interviewRound: doc.interviewRound || '',
    requestedBy: doc.requestedBy || '',
    requesterRole: doc.requesterRole || '',
    requestedAt: doc.requestedAt || null,
    status: doc.status || STATUS.pending,
    reviewedBy: doc.reviewedBy || null,
    reviewedAt: doc.reviewedAt || null,
    reviewNote: doc.reviewNote || null
  };
};

class TranscriptRequestModel {
  constructor() {
    this.collection = null;
  }

  async initialize() {
    this.collection = database.getCollection(COLLECTION);
    await Promise.all([
      this.collection.createIndex(
        { taskId: 1, requestedBy: 1 },
        { unique: true, name: 'uniq_task_requester' }
      ),
      this.collection.createIndex(
        { status: 1, requestedAt: -1 },
        { name: 'status_requestedAt_desc' }
      ),
      this.collection.createIndex(
        { requestedBy: 1, requestedAt: -1 },
        { name: 'requester_requestedAt_desc' }
      )
    ]);

    logger.info('TranscriptRequestModel initialized');
  }

  async getRequestForUser(taskId, requestedBy) {
    const doc = await this.collection.findOne({
      taskId: String(taskId).trim(),
      requestedBy: toNormalizedEmail(requestedBy)
    });
    return mapDocument(doc);
  }

  async getRequestsForUserByTaskIds(taskIds = [], requestedBy) {
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return [];
    }

    const normalizedIds = Array.from(
      new Set(
        taskIds
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter(Boolean)
      )
    );

    if (normalizedIds.length === 0) {
      return [];
    }

    const docs = await this.collection.find({
      taskId: { $in: normalizedIds },
      requestedBy: toNormalizedEmail(requestedBy)
    }).toArray();

    return docs.map(mapDocument).filter(Boolean);
  }

  async upsertPendingRequest({
    taskId,
    taskSubject,
    transcriptTitle,
    candidateName,
    interviewDate,
    interviewRound,
    requestedBy,
    requesterRole
  }) {
    const normalizedTaskId = String(taskId || '').trim();
    const normalizedRequester = toNormalizedEmail(requestedBy);

    const now = new Date().toISOString();
    const filter = {
      taskId: normalizedTaskId,
      requestedBy: normalizedRequester
    };

    const existing = await this.collection.findOne(filter);

    if (!existing) {
      const doc = {
        taskId: normalizedTaskId,
        taskSubject: taskSubject || '',
        transcriptTitle: transcriptTitle || taskSubject || '',
        candidateName: candidateName || '',
        interviewDate: interviewDate || '',
        interviewRound: interviewRound || '',
        requestedBy: normalizedRequester,
        requesterRole: (requesterRole || '').toString().trim().toLowerCase(),
        requestedAt: now,
        status: STATUS.pending,
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null
      };
      const result = await this.collection.insertOne(doc);
      return {
        request: mapDocument({ ...doc, _id: result.insertedId }),
        created: true,
        reactivated: false
      };
    }

    if (existing.status === STATUS.approved) {
      return {
        request: mapDocument(existing),
        created: false,
        reactivated: false
      };
    }

    const updateDoc = {
      $set: {
        taskSubject: taskSubject || existing.taskSubject || '',
        transcriptTitle: transcriptTitle || taskSubject || existing.transcriptTitle || '',
        candidateName: candidateName || existing.candidateName || '',
        interviewDate: interviewDate || existing.interviewDate || '',
        interviewRound: interviewRound || existing.interviewRound || '',
        requesterRole: (requesterRole || existing.requesterRole || '').toString().trim().toLowerCase(),
        requestedAt: now,
        status: STATUS.pending,
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null
      }
    };

    await this.collection.updateOne({ _id: existing._id }, updateDoc);
    const refreshed = await this.collection.findOne({ _id: existing._id });

    return {
      request: mapDocument(refreshed),
      created: false,
      reactivated: true
    };
  }

  async listRequests({ status, limit = 100 } = {}) {
    const query = {};
    if (status && Object.values(STATUS).includes(status)) {
      query.status = status;
    }

    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 1), 500) : 100;

    const docs = await this.collection
      .find(query)
      .sort({ requestedAt: -1 })
      .limit(safeLimit)
      .toArray();

    return docs.map(mapDocument).filter(Boolean);
  }

  async updateRequestStatus(requestId, { status, reviewedBy, reviewNote }) {
    if (!ObjectId.isValid(requestId)) {
      const error = new Error('Invalid transcript request id');
      error.statusCode = 400;
      throw error;
    }

    const normalizedStatus = (status || '').toString().trim().toLowerCase();
    if (!Object.values(STATUS).includes(normalizedStatus) || normalizedStatus === STATUS.pending) {
      const error = new Error('Invalid transcript request status');
      error.statusCode = 400;
      throw error;
    }

    const reviewNoteValue = typeof reviewNote === 'string' && reviewNote.trim().length > 0
      ? reviewNote.trim().slice(0, 2000)
      : null;

    const now = new Date().toISOString();

    const objectId = new ObjectId(requestId);
    const updateResult = await this.collection.updateOne(
      { _id: objectId },
      {
        $set: {
          status: normalizedStatus,
          reviewedBy: toNormalizedEmail(reviewedBy),
          reviewedAt: now,
          reviewNote: reviewNoteValue
        }
      }
    );

    if (!updateResult.matchedCount) {
      return null;
    }

    const updated = await this.collection.findOne({ _id: objectId });
    return mapDocument(updated);
  }

  async countPendingRequests() {
    return this.collection.countDocuments({ status: STATUS.pending });
  }
}

export { STATUS as TRANSCRIPT_REQUEST_STATUS };
export const transcriptRequestModel = new TranscriptRequestModel();
