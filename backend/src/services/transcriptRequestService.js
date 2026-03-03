import { Client, Databases, Query } from 'node-appwrite';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { taskService } from './taskService.js';
import { transcriptRequestModel, TRANSCRIPT_REQUEST_STATUS } from '../models/TranscriptRequest.js';

const ALLOWED_REVIEWER_ROLE = 'admin';

const normalizeEmail = (value = '') => value.toString().trim().toLowerCase();

const normalizeTaskId = (value = '') => value.toString().trim();

const formatTimestamp = (seconds) => {
  if (!Number.isFinite(seconds)) return '';
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const safeLine = (value = '') => value.toString().replace(/\s+/g, ' ').trim();

const resolveStartSeconds = (entry = {}) => {
  const candidates = [
    entry.start,
    entry.start_time,
    entry.start_seconds,
    entry.startTimeSeconds
  ];

  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

class TranscriptRequestService {
  constructor() {
    if (config.appwrite.endpoint && config.appwrite.projectId && config.appwrite.apiKey) {
      this.client = new Client()
        .setEndpoint(config.appwrite.endpoint)
        .setProject(config.appwrite.projectId)
        .setKey(config.appwrite.apiKey);
      this.databases = new Databases(this.client);
    } else {
      this.databases = null;
      logger.warn('Appwrite not configured. Transcript request flow will be unavailable.');
    }
  }

  ensureUser(user) {
    if (!user?.email || !user?.role) {
      const error = new Error('Authentication required');
      error.statusCode = 401;
      throw error;
    }
  }

  ensureReviewer(user) {
    const role = (user?.role || '').toString().trim().toLowerCase();
    if (role !== ALLOWED_REVIEWER_ROLE) {
      const error = new Error('Only admins can review transcript requests.');
      error.statusCode = 403;
      throw error;
    }
  }

  ensureTranscriptSourceConfigured() {
    if (!this.databases || !config.appwrite.databaseId || !config.appwrite.transcriptsCollectionId) {
      const error = new Error('Transcript source is not configured. Please configure Appwrite transcript collection.');
      error.statusCode = 503;
      throw error;
    }
  }

  async getAccessibleTask(taskId, user) {
    const normalizedTaskId = normalizeTaskId(taskId);
    if (!normalizedTaskId) {
      const error = new Error('Task id is required');
      error.statusCode = 400;
      throw error;
    }

    const result = await taskService.getTaskById(
      normalizedTaskId,
      user.email,
      user.role,
      user.teamLead,
      user.manager
    );

    if (!result?.task) {
      const error = new Error('Task not found');
      error.statusCode = 404;
      throw error;
    }

    return result.task;
  }

  normalizeTranscriptDocument(doc = {}) {
    if (doc?.sentences_json && typeof doc.sentences_json === 'string' && !Array.isArray(doc.sentences)) {
      try {
        doc.sentences = JSON.parse(doc.sentences_json);
      } catch (error) {
        logger.warn('Failed to parse transcript sentences_json', {
          transcriptId: doc?.$id || 'unknown',
          error: error.message
        });
      }
    }
    return doc;
  }

  async fetchTranscriptDocumentByTitle(title) {
    this.ensureTranscriptSourceConfigured();

    const normalizedTitle = safeLine(title);
    if (!normalizedTitle) {
      return null;
    }

    const response = await this.databases.listDocuments(
      config.appwrite.databaseId,
      config.appwrite.transcriptsCollectionId,
      [Query.equal('title', normalizedTitle), Query.limit(1)]
    );

    if (!response || !Array.isArray(response.documents) || response.documents.length === 0) {
      return null;
    }

    return this.normalizeTranscriptDocument(response.documents[0]);
  }

  async fetchTranscriptDocumentForTask(task) {
    const title = safeLine(task?.subject || task?.Subject || task?.title || '');
    if (!title) {
      return null;
    }
    return this.fetchTranscriptDocumentByTitle(title);
  }

  buildTranscriptTextFromSentences(sentences = []) {
    if (!Array.isArray(sentences) || sentences.length === 0) {
      return '';
    }

    const lines = sentences
      .map((entry) => {
        const text = safeLine(entry?.raw_text || entry?.text || '');
        if (!text) return null;

        const speaker = safeLine(entry?.speaker_name || '');
        const speakerId = Number.isFinite(Number(entry?.speaker_id))
          ? `Speaker ${Number(entry.speaker_id)}`
          : '';
        const prefixSpeaker = speaker || speakerId;
        const startSeconds = resolveStartSeconds(entry);
        const timestamp = startSeconds === null ? '' : formatTimestamp(startSeconds);
        const timePrefix = timestamp ? `[${timestamp}] ` : '';
        const speakerPrefix = prefixSpeaker ? `${prefixSpeaker}: ` : '';

        return `${timePrefix}${speakerPrefix}${text}`;
      })
      .filter(Boolean);

    return lines.join('\n').trim();
  }

  buildTranscriptText(doc = {}) {
    const directFields = [
      'transcript',
      'content',
      'text',
      'full_text',
      'formatted_transcript'
    ];

    for (const field of directFields) {
      const value = safeLine(doc?.[field] || '');
      if (value) {
        return value;
      }
    }

    const sentenceText = this.buildTranscriptTextFromSentences(doc?.sentences || []);
    if (sentenceText) {
      return sentenceText;
    }

    return '';
  }

  formatStatusPayload(request) {
    if (!request) {
      return {
        status: 'none',
        requestedAt: null,
        reviewedAt: null,
        reviewNote: null
      };
    }

    return {
      status: request.status,
      requestedAt: request.requestedAt || null,
      reviewedAt: request.reviewedAt || null,
      reviewNote: request.reviewNote || null
    };
  }

  async requestTranscriptAccess({ taskId, user }) {
    this.ensureUser(user);

    const task = await this.getAccessibleTask(taskId, user);
    const transcriptDoc = await this.fetchTranscriptDocumentForTask(task);
    if (!transcriptDoc) {
      const error = new Error('Transcript is not available for this task (TxAv missing).');
      error.statusCode = 400;
      throw error;
    }

    const result = await transcriptRequestModel.upsertPendingRequest({
      taskId: normalizeTaskId(taskId),
      taskSubject: safeLine(task?.subject || task?.Subject || ''),
      transcriptTitle: safeLine(transcriptDoc?.title || task?.subject || task?.Subject || ''),
      candidateName: safeLine(task?.['Candidate Name'] || task?.candidateName || ''),
      interviewDate: safeLine(task?.['Date of Interview'] || ''),
      interviewRound: safeLine(task?.['Interview Round'] || ''),
      requestedBy: user.email,
      requesterRole: user.role
    });

    if (!result?.request) {
      const error = new Error('Unable to create transcript request.');
      error.statusCode = 500;
      throw error;
    }

    const status = result.request.status;
    let message = 'Transcript request submitted for admin approval.';

    if (status === TRANSCRIPT_REQUEST_STATUS.approved) {
      message = 'Transcript access is already approved for you.';
    } else if (result.reactivated) {
      message = 'Transcript request re-submitted for admin approval.';
    } else if (!result.created) {
      message = 'Transcript request is already pending admin approval.';
    }

    return {
      request: result.request,
      message
    };
  }

  async getMyTaskRequestStatus({ taskId, user }) {
    this.ensureUser(user);
    await this.getAccessibleTask(taskId, user);

    const request = await transcriptRequestModel.getRequestForUser(taskId, user.email);
    return this.formatStatusPayload(request);
  }

  async getMyTaskRequestStatuses({ taskIds, user }) {
    this.ensureUser(user);

    const normalizedIds = Array.from(
      new Set(
        (Array.isArray(taskIds) ? taskIds : [])
          .map((value) => normalizeTaskId(value))
          .filter(Boolean)
      )
    ).slice(0, 200);

    const visibleTaskIds = [];
    for (const taskId of normalizedIds) {
      try {
        await this.getAccessibleTask(taskId, user);
        visibleTaskIds.push(taskId);
      } catch (error) {
        continue;
      }
    }

    const requests = await transcriptRequestModel.getRequestsForUserByTaskIds(visibleTaskIds, user.email);
    const requestByTask = new Map(requests.map((request) => [request.taskId, request]));
    const statusByTaskId = {};

    for (const taskId of visibleTaskIds) {
      statusByTaskId[taskId] = this.formatStatusPayload(requestByTask.get(taskId));
    }

    return {
      statuses: statusByTaskId
    };
  }

  async listTranscriptRequests({ status, limit, user }) {
    this.ensureUser(user);
    this.ensureReviewer(user);

    const normalizedStatus = (status || '').toString().trim().toLowerCase();
    const safeStatus = Object.values(TRANSCRIPT_REQUEST_STATUS).includes(normalizedStatus)
      ? normalizedStatus
      : undefined;

    const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 100;
    const requests = await transcriptRequestModel.listRequests({
      status: safeStatus,
      limit: safeLimit
    });

    return {
      requests
    };
  }

  async reviewTranscriptRequest({ requestId, action, note, user }) {
    this.ensureUser(user);
    this.ensureReviewer(user);

    const normalizedAction = (action || '').toString().trim().toLowerCase();
    if (!['approve', 'reject'].includes(normalizedAction)) {
      const error = new Error('Action must be either approve or reject.');
      error.statusCode = 400;
      throw error;
    }

    const status = normalizedAction === 'approve'
      ? TRANSCRIPT_REQUEST_STATUS.approved
      : TRANSCRIPT_REQUEST_STATUS.rejected;

    const updated = await transcriptRequestModel.updateRequestStatus(requestId, {
      status,
      reviewedBy: normalizeEmail(user.email),
      reviewNote: typeof note === 'string' ? note : ''
    });

    if (!updated) {
      const error = new Error('Transcript request not found.');
      error.statusCode = 404;
      throw error;
    }

    return {
      request: updated
    };
  }

  async getPendingTranscriptRequestCount({ user }) {
    this.ensureUser(user);
    this.ensureReviewer(user);

    const count = await transcriptRequestModel.countPendingRequests();
    return { count };
  }

  async getTranscriptForTask({ taskId, user }) {
    this.ensureUser(user);

    const task = await this.getAccessibleTask(taskId, user);
    const role = (user.role || '').toString().trim().toLowerCase();

    if (role !== ALLOWED_REVIEWER_ROLE) {
      const request = await transcriptRequestModel.getRequestForUser(taskId, user.email);
      if (!request || request.status !== TRANSCRIPT_REQUEST_STATUS.approved) {
        const error = new Error('Transcript access is not approved yet.');
        error.statusCode = 403;
        throw error;
      }
    }

    const transcriptDoc = await this.fetchTranscriptDocumentForTask(task);
    if (!transcriptDoc) {
      const error = new Error('Transcript not found for this task.');
      error.statusCode = 404;
      throw error;
    }

    const transcriptText = this.buildTranscriptText(transcriptDoc);
    if (!transcriptText) {
      const error = new Error('Transcript content is empty.');
      error.statusCode = 404;
      throw error;
    }

    return {
      title: safeLine(transcriptDoc.title || task.subject || task.Subject || ''),
      transcriptText,
      generatedAt: transcriptDoc.updatedAt || transcriptDoc.$updatedAt || transcriptDoc.$createdAt || null
    };
  }
}

export { TranscriptRequestService };
export const transcriptRequestService = new TranscriptRequestService();
