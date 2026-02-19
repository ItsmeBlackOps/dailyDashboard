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
  createdBy: 1,
  metadata: 1,
  resumeLink: 1,
  docType: 1,
  status: 1
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

    // Create indexes for efficient querying
    try {
      await Promise.all([
        this.collection.createIndex({ Recruiter: 1 }),
        this.collection.createIndex({ Expert: 1 }),
        this.collection.createIndex({ workflowStatus: 1 }),
        this.collection.createIndex({ resumeUnderstandingStatus: 1 }),
        this.collection.createIndex({ 'Candidate Name': 1 })
      ]);
      logger.info('CandidateModel initialized and indexes verified');
    } catch (error) {
      logger.error('Failed to create indexes for CandidateModel', { error: error.message });
    }
  }

  async getCandidatesByBranch(branch, { limit, search } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const query = { Branch: branch, docType: { $in: [null, 'candidate'] } };
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

    const query = { docType: { $in: [null, 'candidate'] } };
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

  async getCandidatesByRecruiters(recruiterEmails, { limit, search, visibility, workflowStatus, resumeUnderstandingStatus } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!Array.isArray(recruiterEmails) || recruiterEmails.length === 0) {
      return [];
    }

    const recruiterMatchers = new Set(
      recruiterEmails
        .map((email) => (typeof email === 'string' ? email : ''))
        .filter(Boolean)
    );

    const aliasList = Array.isArray(visibility?.recruiterAliases)
      ? visibility.recruiterAliases.filter(Boolean)
      : [];

    for (const alias of aliasList) {
      recruiterMatchers.add(alias);
    }

    const senderPatterns = Array.isArray(visibility?.senderPatterns)
      ? visibility.senderPatterns.filter(Boolean)
      : [];

    const ccPatterns = Array.isArray(visibility?.ccPatterns)
      ? visibility.ccPatterns.filter(Boolean)
      : [];

    const orConditions = [];

    for (const matcher of recruiterMatchers) {
      orConditions.push({
        Recruiter: { $regex: `^${escapeRegex(matcher)}$`, $options: 'i' }
      });
    }

    const senderFields = ['source.sender', 'source.headers.From'];
    for (const pattern of senderPatterns) {
      for (const field of senderFields) {
        orConditions.push({ [field]: { $regex: pattern, $options: 'i' } });
      }
    }

    const ccFields = ['source.cc', 'source.headers.Cc'];
    for (const pattern of ccPatterns) {
      for (const field of ccFields) {
        orConditions.push({ [field]: { $regex: pattern, $options: 'i' } });
      }
    }

    if (orConditions.length === 0) {
      return [];
    }

    const query = {
      $or: orConditions,
      docType: { $in: [null, 'candidate'] }
    };

    if (workflowStatus) {
      query.workflowStatus = Array.isArray(workflowStatus) ? { $in: workflowStatus } : workflowStatus;
    }

    if (resumeUnderstandingStatus) {
      query.resumeUnderstandingStatus = resumeUnderstandingStatus;
    }

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

    const filter = {
      _id: objectId,
      docType: { $in: [null, 'candidate'] }
    };

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
        ...(updates.resumeLink !== undefined ? { resumeLink: updates.resumeLink } : {}),
        ...(updates.status !== undefined ? { status: updates.status } : {}),
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
      resumeLink: payload.resumeLink || '',
      source: payload.source || {},
      workflowStatus: payload.workflowStatus || WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: payload.resumeUnderstandingStatus || RESUME_UNDERSTANDING_STATUS.pending,
      status: payload.status || 'active',
      createdBy: payload.createdBy || null,
      updated_at: now,
      _last_write: now,
      created_at: now,
      docType: 'candidate'
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

  async getCandidatesByExperts(expertEmails, { limit, search, status } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!Array.isArray(expertEmails) || expertEmails.length === 0) {
      return [];
    }

    const orConditions = expertEmails.map((email) => ({
      Expert: { $regex: `^${escapeRegex(email)}$`, $options: 'i' }
    }));

    const query = { $or: orConditions, docType: { $in: [null, 'candidate'] } };

    if (status) {
      query.resumeUnderstandingStatus = status;
    }

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

    const document = await this.collection.findOne({
      _id: objectId,
      docType: { $in: [null, 'candidate'] }
    }, {
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

  async countResumeUnderstandingTasksForExperts(expertEmails, status = RESUME_UNDERSTANDING_STATUS.pending) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!Array.isArray(expertEmails) || expertEmails.length === 0) {
      return 0;
    }

    const normalizedStatus = status === RESUME_UNDERSTANDING_STATUS.done
      ? RESUME_UNDERSTANDING_STATUS.done
      : RESUME_UNDERSTANDING_STATUS.pending;

    const matchers = expertEmails
      .map((email) => (typeof email === 'string' ? email.trim().toLowerCase() : ''))
      .filter(Boolean)
      .map((email) => ({
        Expert: { $regex: `^${escapeRegex(email)}$`, $options: 'i' }
      }));

    if (matchers.length === 0) {
      return 0;
    }

    const query = {
      resumeUnderstandingStatus: normalizedStatus,
      ...(matchers.length === 1 ? matchers[0] : { $or: matchers })
    };

    return this.collection.countDocuments(query);
  }

  async countCandidatesByWorkflowStatuses(statuses = []) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    const normalizedStatuses = Array.isArray(statuses)
      ? statuses.filter(Boolean)
      : [];

    if (normalizedStatuses.length === 0) {
      return 0;
    }

    const query = {
      workflowStatus: { $in: normalizedStatuses },
      docType: { $in: [null, 'candidate'] }
    };

    return this.collection.countDocuments(query);
  }

  async getUserProfileMetadata(email) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!email) {
      throw new Error('Email is required');
    }

    const lowerEmail = email.toLowerCase();

    return this.collection.findOne(
      { docType: 'userProfile', email: lowerEmail },
      {
        projection: { _id: 1, email: 1, metadata: 1, docType: 1, created_at: 1, updated_at: 1 },
        collation: { locale: 'en', strength: 2 }
      }
    );
  }

  async upsertUserProfileMetadata(email, metadata = {}, { upsert = true } = {}) {
    if (!this.collection) {
      throw new Error('Candidate collection not initialized');
    }

    if (!email) {
      throw new Error('Email is required');
    }

    const lowerEmail = email.toLowerCase();
    const now = new Date();
    const filter = { docType: 'userProfile', email: lowerEmail };
    const updateDoc = {
      $set: {
        metadata,
        email: lowerEmail,
        docType: 'userProfile',
        updated_at: now
      },
      ...(upsert
        ? {
          $setOnInsert: {
            docType: 'userProfile',
            email: lowerEmail,
            created_at: now
          }
        }
        : {})
    };

    const options = {
      upsert,
      collation: { locale: 'en', strength: 2 }
    };

    const result = await this.collection.updateOne(filter, updateDoc, options);

    if (!upsert && result.matchedCount === 0) {
      const error = new Error('User profile metadata not found');
      error.statusCode = 404;
      throw error;
    }

    return result;
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
      status: doc.status || 'Active',
      receivedDate: doc.source?.receivedDateTime ?? null,
      updatedAt: doc.updated_at instanceof Date ? doc.updated_at.toISOString() : doc.updated_at ?? null,
      lastWriteAt: doc._last_write instanceof Date ? doc._last_write.toISOString() : doc._last_write ?? null,
      workflowStatus: doc.workflowStatus || WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: doc.resumeUnderstandingStatus || RESUME_UNDERSTANDING_STATUS.pending,
      resumeUnderstanding: Boolean(doc.resumeUnderstanding),
      createdBy: doc.createdBy || null,
      resumeLink: doc.resumeLink || ''
    };
  }
}

export const candidateModel = new CandidateModel();
