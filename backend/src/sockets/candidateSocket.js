import { candidateService } from '../services/candidateService.js';
import {
  validateCandidateQuery,
  validateCandidateUpdate,
  sanitizeObject,
  validateCandidateCreate,
  validateAssignExpert,
  validateResumeUnderstanding,
  validateResumeQueueQuery,
  validateResumeCountQuery
} from '../middleware/validation.js';
import { socketAsyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

class CandidateSocketHandler {
  handleConnection(socket) {
    socket.on('getBranchCandidates', socketAsyncHandler(this.handleGetBranchCandidates.bind(this)));
    socket.on('updateBranchCandidate', socketAsyncHandler(this.handleUpdateCandidate.bind(this)));
    socket.on('createCandidate', socketAsyncHandler(this.handleCreateCandidate.bind(this)));
    socket.on('assignCandidateExpert', socketAsyncHandler(this.handleAssignExpert.bind(this)));
    socket.on('updateResumeUnderstanding', socketAsyncHandler(this.handleResumeUnderstanding.bind(this)));
    socket.on('getPendingExpertAssignments', socketAsyncHandler(this.handleGetPendingExpertAssignments.bind(this)));
    socket.on('getResumeUnderstandingQueue', socketAsyncHandler(this.handleGetResumeUnderstandingQueue.bind(this)));
    socket.on('getResumeUnderstandingCount', socketAsyncHandler(this.handleGetResumeUnderstandingCount.bind(this)));
  }

  async handleGetBranchCandidates(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('BranchCandidates callback missing', { socketId: socket.id });
        return;
      }

      const user = socket.data.user;
      if (!user) {
        return callback({
          success: false,
          error: 'Authentication required'
        });
      }

      const sanitizedData = sanitizeObject(data || {});
      const validation = validateCandidateQuery(sanitizedData);

      if (!validation.isValid) {
        logger.warn('Candidate query validation failed', {
          errors: validation.errors,
          socketId: socket.id,
          userEmail: user.email
        });

        return callback({
          success: false,
          error: 'Validation failed',
          details: validation.errors
        });
      }

      const limit = sanitizedData.limit !== undefined ? Number(sanitizedData.limit) : undefined;
      const search = typeof sanitizedData.search === 'string' ? sanitizedData.search : undefined;

      const result = await candidateService.getCandidatesForUser(user, {
        limit,
        search
      });

      const response = {
        success: true,
        scope: result.scope,
        candidates: result.candidates,
        meta: result.meta,
        options: result.options || null
      };

      if (result.scope?.type === 'branch') {
        response.branch = result.scope.value;
      }

      if (result.scope?.type === 'hierarchy') {
        response.recruiters = result.scope.value;
      }

      return callback(response);
    } catch (error) {
      logger.error('Socket getBranchCandidates failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      return callback({
        success: false,
        error: error.statusCode === 403 ? error.message : 'Unable to load candidates'
      });
    }
  }

  async handleUpdateCandidate(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('updateBranchCandidate callback missing', { socketId: socket.id });
        return;
      }

      const user = socket.data.user;
      if (!user) {
        return callback({ success: false, error: 'Authentication required' });
      }

      const sanitizedData = sanitizeObject(data || {});
      const validation = validateCandidateUpdate(sanitizedData);

      if (!validation.isValid) {
        logger.warn('Candidate update validation failed', {
          errors: validation.errors,
          socketId: socket.id,
          userEmail: user.email
        });

        return callback({
          success: false,
          error: 'Validation failed',
          details: validation.errors
        });
      }

      const { candidateId, ...payload } = validation.payload;

      const updated = await candidateService.updateCandidateDetails(user, candidateId, payload);

      return callback({
        success: true,
        candidate: updated
      });
    } catch (error) {
      logger.error('Socket updateBranchCandidate failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      return callback({
        success: false,
        error: error.statusCode === 403 || error.statusCode === 400 ? error.message : 'Unable to update candidate'
      });
    }
  }

  async handleCreateCandidate(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('createCandidate callback missing', { socketId: socket.id });
        return;
      }

      const user = socket.data.user;
      if (!user) {
        return callback({ success: false, error: 'Authentication required' });
      }

      const sanitizedData = sanitizeObject(data || {});
      const validation = validateCandidateCreate(sanitizedData);

      if (!validation.isValid) {
        logger.warn('Candidate create validation failed', {
          errors: validation.errors,
          socketId: socket.id,
          userEmail: user.email
        });

        return callback({
          success: false,
          error: 'Validation failed',
          details: validation.errors
        });
      }

      const created = await candidateService.createCandidateFromManager(user, validation.payload);

      return callback({ success: true, candidate: created });
    } catch (error) {
      logger.error('Socket createCandidate failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      return callback({
        success: false,
        error: error.statusCode === 403 || error.statusCode === 400 ? error.message : 'Unable to create candidate'
      });
    }
  }

  async handleAssignExpert(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('assignCandidateExpert callback missing', { socketId: socket.id });
        return;
      }

      const user = socket.data.user;
      if (!user) {
        return callback({ success: false, error: 'Authentication required' });
      }

      const sanitizedData = sanitizeObject(data || {});
      const validation = validateAssignExpert(sanitizedData);

      if (!validation.isValid) {
        logger.warn('Assign expert validation failed', {
          errors: validation.errors,
          socketId: socket.id,
          userEmail: user.email
        });

        return callback({
          success: false,
          error: 'Validation failed',
          details: validation.errors
        });
      }

      const { candidateId, expert } = validation.payload;
      const updated = await candidateService.assignExpert(user, candidateId, expert);

      this.emitToRoles(socket, ['admin'], 'candidateExpertAssigned', { candidate: updated });
      this.emitToUser(socket, updated.expertRaw || expert, 'resumeUnderstandingAssigned', {
        candidate: updated
      });

      return callback({ success: true, candidate: updated });
    } catch (error) {
      logger.error('Socket assignCandidateExpert failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      return callback({
        success: false,
        error: error.statusCode === 403 || error.statusCode === 400 ? error.message : 'Unable to assign expert'
      });
    }
  }

  async handleResumeUnderstanding(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('updateResumeUnderstanding callback missing', { socketId: socket.id });
        return;
      }

      const user = socket.data.user;
      if (!user) {
        return callback({ success: false, error: 'Authentication required' });
      }

      const sanitizedData = sanitizeObject(data || {});
      const validation = validateResumeUnderstanding(sanitizedData);

      if (!validation.isValid) {
        logger.warn('Resume understanding validation failed', {
          errors: validation.errors,
          socketId: socket.id,
          userEmail: user.email
        });

        return callback({
          success: false,
          error: 'Validation failed',
          details: validation.errors
        });
      }

      const { candidateId, status } = validation.payload;
      const updated = await candidateService.updateResumeUnderstanding(user, candidateId, status);

      this.emitToUser(socket, updated.expertRaw || user.email, 'resumeUnderstandingUpdated', {
        candidate: updated
      });
      this.emitToRoles(socket, ['admin'], 'candidateResumeStatusChanged', {
        candidate: updated
      });

      return callback({ success: true, candidate: updated });
    } catch (error) {
      logger.error('Socket updateResumeUnderstanding failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      return callback({
        success: false,
        error: error.statusCode === 403 || error.statusCode === 400 ? error.message : 'Unable to update status'
      });
    }
  }

  async handleGetPendingExpertAssignments(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('getPendingExpertAssignments callback missing', { socketId: socket.id });
        return;
      }

      const user = socket.data.user;
      if (!user) {
        return callback({ success: false, error: 'Authentication required' });
      }

      const sanitizedData = sanitizeObject(data || {});
      const validation = validateCandidateQuery(sanitizedData);

      if (!validation.isValid) {
        logger.warn('Pending expert assignments validation failed', {
          errors: validation.errors,
          socketId: socket.id,
          userEmail: user.email
        });

        return callback({
          success: false,
          error: 'Validation failed',
          details: validation.errors
        });
      }

      const limit = sanitizedData.limit !== undefined ? Number(sanitizedData.limit) : undefined;
      const result = await candidateService.getPendingExpertAssignments(user, { limit });

      return callback({
        success: true,
        candidates: result.candidates,
        options: result.options || null,
        meta: {
          count: result.candidates.length,
          appliedLimit: limit ?? null
        }
      });
    } catch (error) {
      logger.error('Socket getPendingExpertAssignments failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      return callback({
        success: false,
        error: error.statusCode === 403 ? error.message : 'Unable to load pending assignments'
      });
    }
  }

  async handleGetResumeUnderstandingQueue(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('getResumeUnderstandingQueue callback missing', { socketId: socket.id });
        return;
      }

      const user = socket.data.user;
      if (!user) {
        return callback({ success: false, error: 'Authentication required' });
      }

      const sanitizedData = sanitizeObject(data || {});
      const validation = validateResumeQueueQuery(sanitizedData);

      if (!validation.isValid) {
        logger.warn('Resume queue validation failed', {
          errors: validation.errors,
          socketId: socket.id,
          userEmail: user.email
        });

        return callback({
          success: false,
          error: 'Validation failed',
          details: validation.errors
        });
      }

      const { status = 'pending', limit } = validation.payload;

      const candidates = await candidateService.getResumeUnderstandingQueue(
        user,
        status,
        { limit }
      );

      return callback({
        success: true,
        status,
        candidates,
        meta: {
          count: candidates.length,
          appliedLimit: limit ?? null
        }
      });
    } catch (error) {
      logger.error('Socket getResumeUnderstandingQueue failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      return callback({
        success: false,
        error: error.statusCode === 403 ? error.message : 'Unable to load resume understanding queue'
      });
    }
  }

  async handleGetResumeUnderstandingCount(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('getResumeUnderstandingCount callback missing', { socketId: socket.id });
        return;
      }

      const user = socket.data.user;
      if (!user) {
        return callback({ success: false, error: 'Authentication required' });
      }

      const sanitizedData = sanitizeObject(data || {});
      const validation = validateResumeCountQuery(sanitizedData);

      if (!validation.isValid) {
        logger.warn('Resume count validation failed', {
          errors: validation.errors,
          socketId: socket.id,
          userEmail: user.email
        });

        return callback({
          success: false,
          error: 'Validation failed',
          details: validation.errors
        });
      }

      const { status = 'pending' } = validation.payload;
      const count = await candidateService.getResumeUnderstandingCount(user, status);

      return callback({
        success: true,
        status,
        count
      });
    } catch (error) {
      logger.error('Socket getResumeUnderstandingCount failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      return callback({
        success: false,
        error: error.statusCode === 403 ? error.message : 'Unable to load resume understanding count'
      });
    }
  }

  emitToUser(socket, email, event, payload) {
    if (!email || !event) {
      return;
    }

    try {
      const namespace = socket.nsp;
      const normalizedEmail = email.trim().toLowerCase();

      namespace.sockets.forEach((clientSocket) => {
        const clientEmail = clientSocket.data.user?.email?.toLowerCase();
        if (clientEmail && clientEmail === normalizedEmail) {
          clientSocket.emit(event, payload);
        }
      });
    } catch (error) {
      logger.error('emitToUser failed', {
        error: error.message,
        event,
        email
      });
    }
  }

  emitToRoles(socket, roles, event, payload) {
    if (!event) {
      return;
    }

    const normalizedRoles = (Array.isArray(roles) ? roles : [roles])
      .filter(Boolean)
      .map((role) => role.toString().trim().toLowerCase());

    if (normalizedRoles.length === 0) {
      return;
    }

    try {
      const namespace = socket.nsp;

      namespace.sockets.forEach((clientSocket) => {
        const clientRole = clientSocket.data.user?.role?.toLowerCase();
        if (clientRole && normalizedRoles.includes(clientRole)) {
          clientSocket.emit(event, payload);
        }
      });
    } catch (error) {
      logger.error('emitToRoles failed', {
        error: error.message,
        event,
        roles: normalizedRoles
      });
    }
  }
}

export const candidateSocketHandler = new CandidateSocketHandler();
