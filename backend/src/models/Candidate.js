import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const DEFAULT_PROJECTION = {
  _id: 1,
  Branch: 1,
  Recruiter: 1,
  Expert: 1,
  Technology: 1,
  'Candidate Name': 1,
  'Email ID': 1,
  'Contact No': 1,
  _last_write: 1,
  updated_at: 1,
  'Date of Interview': 1,
  source: 1,
  workflowStatus: 1,
  resumeUnderstandingStatus: 1,
  createdBy: 1
};

export const WORKFLOW_STATUS = {
  awaitingExpert: 'awaiting_expert',
  needsResumeUnderstanding: 'needs_resume_understanding',
  completed: 'completed'
};

export const RESUME_UNDERSTANDING_STATUS = {
  pending: 'pending',
  done: 'done'
};

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class CandidateModel {
  constructor() {
    this.collection = null;
  }

  async initialize() {
    this.collection = database.getCollection('candidateDetails');
    logger.info('CandidateModel initialized with candidateDetails collection');
  }

  async getCandidatesByBranch(branch, { limit, search } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const query = { Branch: branch };
    if (search) {
      query['Candidate Name'] = { $regex: search, $options: 'i' };
    }

    let cursor = this.collection
      .find(query, { projection: DEFAULT_PROJECTION })
      .sort({ _last_write: -1 });

    if (Number.isFinite(limit) && limit > 0) {
      cursor = cursor.limit(Math.floor(limit));
    }

    const documents = await cursor.toArray();

    return documents.map((doc) => this.mapDocumentToCandidate(doc));
  }

  async getAllCandidates({ limit, search } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const query = {};
    if (search) {
      query['Candidate Name'] = { $regex: search, $options: 'i' };
    }

    let cursor = this.collection
      .find(query, { projection: DEFAULT_PROJECTION })
      .sort({ _last_write: -1 });

    if (Number.isFinite(limit) && limit > 0) {
      cursor = cursor.limit(Math.floor(limit));
    }

    const documents = await cursor.toArray();

    return documents.map((doc) => this.mapDocumentToCandidate(doc));
  }

  async getCandidatesByRecruiters(recruiterEmails, { limit, search } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!Array.isArray(recruiterEmails) || recruiterEmails.length === 0) {
      return [];
    }

    const orConditions = recruiterEmails.map((email) => ({
      Recruiter: { $regex: `^${escapeRegex(email)}$`, $options: 'i' }
    }));

    const query = {
      $or: orConditions
    };

    if (search) {
      query['Candidate Name'] = { $regex: search, $options: 'i' };
    }

    let cursor = this.collection
      .find(query, { projection: DEFAULT_PROJECTION })
      .sort({ _last_write: -1 });

    if (Number.isFinite(limit) && limit > 0) {
      cursor = cursor.limit(Math.floor(limit));
    }

    const documents = await cursor.toArray();

    return documents.map((doc) => this.mapDocumentToCandidate(doc));
  }

  async updateCandidateById(id, updates = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!id) {
      throw new Error('Candidate id is required');
    }

    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch (error) {
      const invalidIdError = new Error('Invalid candidate id');
      invalidIdError.statusCode = 400;
      throw invalidIdError;
    }

    const filter = { _id: objectId };

    const updateDoc = {
      $set: {
        ...(updates.name !== undefined ? { 'Candidate Name': updates.name } : {}),
        ...(updates.email !== undefined ? { 'Email ID': updates.email } : {}),
        ...(updates.technology !== undefined ? { Technology: updates.technology } : {}),
        ...(updates.recruiter !== undefined ? { Recruiter: updates.recruiter } : {}),
        ...(updates.expert !== undefined ? { Expert: updates.expert } : {}),
        ...(updates.contact !== undefined ? { 'Contact No': updates.contact } : {}),
        ...(updates.workflowStatus !== undefined ? { workflowStatus: updates.workflowStatus } : {}),
        ...(updates.resumeUnderstandingStatus !== undefined ? { resumeUnderstandingStatus: updates.resumeUnderstandingStatus } : {}),
        ...(updates.createdBy !== undefined ? { createdBy: updates.createdBy } : {}),
        updated_at: new Date()
      }
    };

    const result = await this.collection.updateOne(filter, updateDoc);

    if (result.matchedCount === 0) {
      const error = new Error('Candidate not found');
      error.statusCode = 404;
      throw error;
    }

    const updatedCandidate = await this.collection.findOne(filter, {
      projection: DEFAULT_PROJECTION
    });

    return updatedCandidate ? this.mapDocumentToCandidate(updatedCandidate) : null;
  }

  async createCandidate(payload = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const now = new Date();
    const document = {
      Branch: payload.branch || '',
      Recruiter: payload.recruiter || '',
      Expert: payload.expert || '',
      Technology: payload.technology || '',
      'Candidate Name': payload.name || '',
      'Email ID': payload.email || '',
      'Contact No': payload.contact || '',
      source: payload.source || {},
      workflowStatus: payload.workflowStatus || WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: payload.resumeUnderstandingStatus || RESUME_UNDERSTANDING_STATUS.pending,
      createdBy: payload.createdBy || null,
      updated_at: now,
      _last_write: now,
      created_at: now
    };

    const result = await this.collection.insertOne(document);

    logger.info('Candidate inserted', {
      candidateId: result.insertedId.toString(),
      createdBy: payload.createdBy || 'unknown'
    });

    return this.collection.findOne({ _id: result.insertedId }, {
      projection: DEFAULT_PROJECTION
    });
  }

  async assignExpertById(id, expertEmail) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!id) {
      throw new Error('Candidate id is required');
    }

    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch (error) {
      const invalidIdError = new Error('Invalid candidate id');
      invalidIdError.statusCode = 400;
      throw invalidIdError;
    }

    const result = await this.collection.updateOne(
      { _id: objectId },
      {
        $set: {
          Expert: expertEmail,
          workflowStatus: WORKFLOW_STATUS.needsResumeUnderstanding,
          resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
          updated_at: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      const error = new Error('Candidate not found');
      error.statusCode = 404;
      throw error;
    }

    return this.collection.findOne({ _id: objectId }, {
      projection: DEFAULT_PROJECTION
    });
  }

  async updateResumeUnderstandingStatus(id, status) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!id) {
      throw new Error('Candidate id is required');
    }

    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch (error) {
      const invalidIdError = new Error('Invalid candidate id');
      invalidIdError.statusCode = 400;
      throw invalidIdError;
    }

    const normalizedStatus = status === RESUME_UNDERSTANDING_STATUS.done
      ? RESUME_UNDERSTANDING_STATUS.done
      : RESUME_UNDERSTANDING_STATUS.pending;

    const result = await this.collection.updateOne(
      { _id: objectId },
      {
        $set: {
          resumeUnderstandingStatus: normalizedStatus,
          workflowStatus: normalizedStatus === RESUME_UNDERSTANDING_STATUS.done
            ? WORKFLOW_STATUS.completed
            : WORKFLOW_STATUS.needsResumeUnderstanding,
          updated_at: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      const error = new Error('Candidate not found');
      error.statusCode = 404;
      throw error;
    }

    return this.collection.findOne({ _id: objectId }, {
      projection: DEFAULT_PROJECTION
    });
  }

  async getCandidatesByWorkflowStatus(status, { limit } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const statuses = Array.isArray(status) ? status : [status];
    const query = { workflowStatus: { $in: statuses } };

    let cursor = this.collection
      .find(query, {
        projection: DEFAULT_PROJECTION
      })
      .sort({ _last_write: -1 });

    if (Number.isFinite(limit) && limit > 0) {
      cursor = cursor.limit(Math.floor(limit));
    }

    const documents = await cursor.toArray();

    return documents.map((doc) => this.mapDocumentToCandidate(doc));
  }

  async getCandidatesForExpert(expertEmail, statusFilter = null, { limit } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const query = {
      Expert: { $regex: `^${escapeRegex(expertEmail)}$`, $options: 'i' }
    };

    if (statusFilter) {
      query.resumeUnderstandingStatus = statusFilter;
    }

    let cursor = this.collection
      .find(query, {
        projection: DEFAULT_PROJECTION
      })
      .sort({ _last_write: -1 });

    if (Number.isFinite(limit) && limit > 0) {
      cursor = cursor.limit(Math.floor(limit));
    }

    const documents = await cursor.toArray();

    return documents.map((doc) => this.mapDocumentToCandidate(doc));
  }

  async getCandidatesByExperts(expertEmails, { limit, search } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!Array.isArray(expertEmails) || expertEmails.length === 0) {
      return [];
    }

    const orConditions = expertEmails.map((email) => ({
      Expert: { $regex: `^${escapeRegex(email)}$`, $options: 'i' }
    }));

    const query = { $or: orConditions };

    if (search) {
      query['Candidate Name'] = { $regex: search, $options: 'i' };
    }

    let cursor = this.collection
      .find(query, { projection: DEFAULT_PROJECTION })
      .sort({ _last_write: -1 });

    if (Number.isFinite(limit) && limit > 0) {
      cursor = cursor.limit(Math.floor(limit));
    }

    const documents = await cursor.toArray();

    return documents.map((doc) => this.mapDocumentToCandidate(doc));
  }

  async getCandidateById(id) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!id) {
      throw new Error('Candidate id is required');
    }

    let objectId;
    try {
      objectId = new ObjectId(id);
    } catch (error) {
      const invalidIdError = new Error('Invalid candidate id');
      invalidIdError.statusCode = 400;
      throw invalidIdError;
    }

    const document = await this.collection.findOne({ _id: objectId }, {
      projection: DEFAULT_PROJECTION
    });

    return document ? this.mapDocumentToCandidate(document) : null;
  }

  async countResumeUnderstandingTasks(expertEmail, status = RESUME_UNDERSTANDING_STATUS.pending) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!expertEmail) {
      return 0;
    }

    const normalizedStatus = status === RESUME_UNDERSTANDING_STATUS.done
      ? RESUME_UNDERSTANDING_STATUS.done
      : RESUME_UNDERSTANDING_STATUS.pending;

    const query = {
      Expert: { $regex: `^${escapeRegex(expertEmail)}$`, $options: 'i' },
      resumeUnderstandingStatus: normalizedStatus
    };

    return this.collection.countDocuments(query);
  }

  mapDocumentToCandidate(doc) {
    return {
      id: doc._id?.toString?.() ?? String(doc._id),
      name: doc['Candidate Name'] ?? '',
      branch: doc.Branch ?? '',
      recruiter: doc.Recruiter ?? '',
      expert: doc.Expert ?? '',
      technology: doc.Technology ?? '',
      email: doc['Email ID'] ?? '',
      contact: doc['Contact No'] ?? '',
      receivedDate: doc.source?.receivedDateTime ?? null,
      updatedAt: doc.updated_at instanceof Date ? doc.updated_at.toISOString() : doc.updated_at ?? null,
      lastWriteAt: doc._last_write instanceof Date ? doc._last_write.toISOString() : doc._last_write ?? null,
      workflowStatus: doc.workflowStatus || WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: doc.resumeUnderstandingStatus || RESUME_UNDERSTANDING_STATUS.pending,
      createdBy: doc.createdBy || null
    };
  }
}

export const candidateModel = new CandidateModel();
