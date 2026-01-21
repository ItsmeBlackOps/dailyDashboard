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
    socket.on('getPendingExpertAssignmentsCount', socketAsyncHandler(this.handleGetPendingExpertAssignmentsCount.bind(this)));
    socket.on('getResumeUnderstandingQueue', socketAsyncHandler(this.handleGetResumeUnderstandingQueue.bind(this)));
    socket.on('getResumeUnderstandingCount', socketAsyncHandler(this.handleGetResumeUnderstandingCount.bind(this)));
    socket.on('getResumeComments', socketAsyncHandler(this.handleGetResumeComments.bind(this)));
    socket.on('addResumeComment', socketAsyncHandler(this.handleAddResumeComment.bind(this)));
    socket.on('joinCandidateRoom', (candidateId) => {
      if (candidateId) socket.join(`candidate:${candidateId}`);
    });
    socket.on('leaveCandidateRoom', (candidateId) => {
      if (candidateId) socket.leave(`candidate:${candidateId}`);
    });

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

      const search = typeof sanitizedData.search === 'string' ? sanitizedData.search : undefined;

      const result = await candidateService.getCandidatesForUser(user, {
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

      const assignmentWatchers = candidateService.resolveResumeUnderstandingWatchers(updated.expertRaw || expert);
      for (const watcher of assignmentWatchers) {
        this.emitToUser(socket, watcher, 'resumeUnderstandingAssigned', {
          candidate: updated
        });
      }

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

  async handleGetPendingExpertAssignmentsCount(socket, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('getPendingExpertAssignmentsCount callback missing', { socketId: socket.id });
        return;
      }

      const user = socket.data.user;
      if (!user) {
        return callback({ success: false, error: 'Authentication required' });
      }

      const count = await candidateService.getPendingExpertAssignmentCount(user);

      return callback({
        success: true,
        count
      });
    } catch (error) {
      logger.error('Socket getPendingExpertAssignmentsCount failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      return callback({
        success: false,
        error: error.statusCode === 403 ? error.message : 'Unable to load pending expert assignments'
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

      const updateWatchers = candidateService.resolveResumeUnderstandingWatchers(updated.expertRaw || user.email);
      for (const watcher of updateWatchers) {
        this.emitToUser(socket, watcher, 'resumeUnderstandingUpdated', {
          candidate: updated
        });
      }
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

  async handleGetPendingExpertAssignments(socket, dataOrCallback, maybeCallback) {
    try {
      const callback = typeof dataOrCallback === 'function' ? dataOrCallback : maybeCallback;
      const rawData = typeof dataOrCallback === 'function' ? {} : dataOrCallback;

      if (!callback || typeof callback !== 'function') {
        logger.warn('getPendingExpertAssignments callback missing', { socketId: socket.id });
        return;
      }

      const user = socket.data.user;
      if (!user) {
        return callback({ success: false, error: 'Authentication required' });
      }

      const sanitizedData = sanitizeObject(rawData || {});
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

  async handleGetResumeComments(socket, payload, callback) {
    const { candidateId } = payload;
    const user = socket.data.user;

    try {
      const comments = await candidateService.getComments(user, candidateId);
      return callback({ success: true, data: comments });
    } catch (error) {
      logger.error('handleGetResumeComments failed', {
        error: error.message,
        candidateId,
        user: user?.email
      });

      return callback({
        success: false,
        error: error.statusCode === 403 ? error.message : 'Unable to load comments'
      });
    }
  }

  async handleAddResumeComment(socket, payload, callback) {
    const { candidateId, content, type } = payload;
    const user = socket.data.user;
    let comment;

    try {
      comment = await candidateService.addComment(user, candidateId, content, type);
    } catch (error) {
      logger.error('handleAddResumeComment failed', {
        error: error.message,
        candidateId,
        user: user?.email
      });

      return callback({
        success: false,
        error: error.statusCode === 403 ? error.message : 'Unable to add comment'
      });
    }

    // Notifications (Non-critical path)
    try {
      // 1. Broadcast to room (real-time chat for those open)
      this.emitToCandidateRoom(socket, candidateId, 'newComment', {
        candidateId,
        comment
      });

      // 2. Global Notification (for those NOT in room or minimized)
      const candidate = await candidateService.getCandidateById(user, candidateId);

      if (candidate) {
        this.emitCommentNotifications(socket, candidate, comment, user);
      } else {
        logger.warn('Candidate not found for notification', { candidateId });
      }
    } catch (notificationError) {
      // Log error but do not fail the request since comment was saved
      logger.error('Comment notification failed', {
        error: notificationError.message,
        candidateId,
        user: user?.email
      });
    }

    return callback({ success: true, data: comment });
  }

  emitCommentNotifications(socket, candidate, comment, sender) {
    if (!candidate) return;

    const recipients = new Set();
    const senderEmail = sender.email.toLowerCase();
    const senderRole = sender.role.toLowerCase();

    // Helpers
    const addRole = (r) => {
      // In a real app we'd map role -> users. Here we might need a helper method or broadcast to room 'role:admin'
      // For simplicity, we will emit to specific users if known, and broadcast to roles.
      // socket.to(`role:${r}`).emit(...)
      // Assuming we have rooms for roles from authSocket or similar.
      this.emitToRole(socket, r, 'newCommentNotification', { candidate, comment });
    };

    const addUser = (email) => {
      if (email && email.toLowerCase() !== senderEmail) {
        this.emitToUser(socket, email, 'newCommentNotification', { candidate, comment });
      }
    };

    // Logic
    const expertEmail = (candidate.expertRaw || "").trim();
    const recruiterEmail = (candidate.recruiter || "").trim(); // This might be name, need email if stored. 
    // Checking candidate schema: 'recruiter' is string (name?). 
    // If we don't have recruiter email, we might rely on 'created_by' or 'manager'.
    // For now, we'll notify known roles.

    const isComplaint = comment.type === 'complaint';

    // 1. Notify Admin/Leads (Always)
    addRole('admin');
    addRole('lead');
    addRole('manager');
    addRole('am');
    addRole('mam');
    addRole('mlead');

    // 2. Notify Expert (Only if NOT complaint)
    if (!isComplaint) {
      if (senderRole !== 'expert') {
        // If sender is NOT expert, notify expert
        addUser(expertEmail);
      }
    }

    // 3. Notify Recruiter (If known)
    // If the sender is the Expert, we definitely want the Recruiter to know.
    // Since we might not have recruiter EMAIL in candidate.recruiter (it's often a name),
    // we rely on the implementation that Recruiters are listening to 'role:recruiter' or we skip if unknown.
    // But typically we should try.
    // (Skipping specific recruiter email lookup for now to avoid complexity without schema check, relying on role broadcast if applicable or just Admin/Lead safety net).
    if (senderRole === 'expert') {
      // Expert wrote something -> Notify generic recruiter role? Or specific?
      // addRole('recruiter'); // Might be too noisy.
    }
  }

  emitToCandidateRoom(socket, candidateId, event, payload) {
    const namespace = socket.nsp;
    const room = `candidate:${candidateId}`;
    const { comment } = payload;

    // If it's a complaint, we manually filter recipients
    if (comment && comment.type === 'complaint') {
      const roomSockets = namespace.adapter.rooms.get(room);
      if (roomSockets) {
        for (const socketId of roomSockets) {
          const clientSocket = namespace.sockets.get(socketId);
          if (clientSocket) {
            const role = clientSocket.data.user?.role?.toLowerCase();
            // Experts cannot see complaints
            if (role !== 'expert' && role !== 'user') {
              clientSocket.emit(event, payload);
            }
          }
        }
      }
    } else {
      // Normal broadcast
      socket.to(room).emit(event, payload);
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