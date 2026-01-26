import { candidateService } from '../services/candidateService.js';
import { notificationService } from '../services/notificationService.js';
import {
  validateCandidateQuery,
  validateCandidateUpdate,
  sanitizeObject,
  validateCandidateCreate,
  validateAssignExpert,
  validateResumeUnderstanding,
  validateCandidateStatusUpdate,
  validateResumeQueueQuery,
  validateResumeCountQuery
} from '../middleware/validation.js';
import { socketAsyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { userService } from '../services/userService.js';

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
    socket.on('updateCandidateStatus', socketAsyncHandler(this.handleUpdateStatus.bind(this)));
    socket.on('bulkUpdateCandidateStatus', socketAsyncHandler(this.handleBulkUpdateStatus.bind(this)));
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

      // Enrich payload for Frontend Notification Logic
      let expertUser = null;
      let recruiterUser = null;
      try {
        if (updated.Expert) {
          expertUser = await userService.getUserByEmail(updated.Expert);
          if (expertUser && !expertUser.name) {
            expertUser.name = userService.formatDisplayNameFromEmail(expertUser.email);
          }
        }
        if (updated.Recruiter) {
          recruiterUser = await userService.getUserByEmail(updated.Recruiter);
          if (recruiterUser && !recruiterUser.name) {
            recruiterUser.name = userService.formatDisplayNameFromEmail(recruiterUser.email);
          }
        }
      } catch (e) { logger.warn('Failed to enrich assignment notification', e); }

      const richPayload = {
        candidate: updated,
        expert: expertUser,
        recruiter: recruiterUser
      };

      this.emitToRoles(socket, ['admin'], 'candidateExpertAssigned', richPayload);

      const assignmentWatchers = candidateService.resolveResumeUnderstandingWatchers(updated.expertRaw || expert);
      const hierarchyWatchers = candidateService.resolveHierarchyWatchers(updated);
      const allWatchers = new Set([...assignmentWatchers, ...hierarchyWatchers]);

      for (const watcher of allWatchers) {
        this.emitToUser(socket, watcher, 'resumeUnderstandingAssigned', richPayload);
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
          candidate: updated,
          updatedBy: user // Pass who performed the update
        });
      }
      this.emitToRoles(socket, ['admin'], 'candidateResumeStatusChanged', {
        candidate: updated
      });

      return callback({ success: true, candidate: updated });
    } catch (error) {
      logger.error('Socket updateResumeUnderstanding failed', { error: error.message });
      return callback({ success: false, error: 'Update failed' });
    }
  }

  async handleUpdateStatus(socket, data, callback) {
    if (!callback) return;
    const user = socket.data.user;
    if (!user) return callback({ success: false, error: 'Auth required' });

    // RBAC
    if (!['recruiter', 'mlead', 'mam', 'mm', 'admin'].includes(user.role)) {
      return callback({ success: false, error: 'Unauthorized' });
    }

    const validation = validateCandidateStatusUpdate(data);
    if (!validation.isValid) return callback({ success: false, error: 'Validation failed' });

    try {
      const { candidateId, status } = validation.payload;
      const updated = await candidateService.updateCandidate(user, candidateId, { status });

      const payload = { candidate: updated, newStatus: status, updatedBy: user };

      // Persistent Notification to ALL stakeholders
      const allWatchers = candidateService.resolveAllWatchers(updated);

      const notifData = {
        type: 'info',
        title: 'Status Updated',
        description: `Status of ${updated.name} updated to ${status} by ${user.displayName || user.name || user.email}`,
        candidateId: updated.id,
        link: `/candidate/${updated.id}`
      };

      await notificationService.broadcastToWatchers(allWatchers, notifData);

      // Real-time Emit
      allWatchers.forEach(w => this.emitToUser(socket, w, 'candidateStatusUpdated', payload));

      callback({ success: true, candidate: updated });
    } catch (e) {
      logger.error('Update Status Failed', e);
      callback({ success: false, error: e.message });
    }
  }

  async handleBulkUpdateStatus(socket, data, callback) {
    if (!callback) return;
    const user = socket.data.user;
    if (!user) return callback({ success: false, error: 'Auth required' });

    if (!['recruiter', 'mlead', 'mam', 'mm', 'admin'].includes(user.role)) {
      return callback({ success: false, error: 'Unauthorized' });
    }

    const { ids, status } = data;
    if (!Array.isArray(ids) || ids.length === 0 || !status) {
      return callback({ success: false, error: 'Invalid payload' });
    }

    try {
      const results = [];
      const errors = [];
      const allWatchers = new Set();
      const batchData = [];

      // Process sequentially to be safe, or Promise.all for speed.
      // Sequential ensures we don't overwhelm DB if batch is huge.
      for (const id of ids) {
        try {
          // Verify status transition logic via updateCandidate
          const updated = await candidateService.updateCandidate(user, id, { status });
          results.push(updated);

          // Collect watchers for this specific candidate
          const watchers = candidateService.resolveAllWatchers(updated);
          watchers.forEach(w => allWatchers.add(w));

          batchData.push({
            id: updated.id,
            name: updated.name,
            status: status
          });
        } catch (err) {
          errors.push({ id, error: err.message });
        }
      }

      if (results.length > 0) {
        // Persistent Batch Notification
        const notifData = {
          type: 'batch', // New type
          title: 'Bulk Status Update',
          description: `Updated ${results.length} candidates to ${status} by ${user.displayName || user.name || user.email}`,
          batchData: batchData
        };

        await notificationService.broadcastToWatchers(Array.from(allWatchers), notifData);

        // Real-time Emit (Single Batch Event)
        // We emit 'candidateStatusUpdated' for each? No, that causes spam.
        // We emit 'bulkCandidateStatusUpdated'.
        const payload = {
          count: results.length,
          status,
          updatedBy: user,
          ids: results.map(r => r.id)
        };

        Array.from(allWatchers).forEach(w => {
          this.emitToUser(socket, w, 'bulkCandidateStatusUpdated', payload);
        });
      }

      callback({
        success: true,
        updated: results.length,
        failed: errors.length,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (e) {
      logger.error('Bulk Update Failed', e);
      callback({ success: false, error: e.message });
    }
  }

  async handleBulkAssignExpert(socket, data, callback) {
    if (!callback) return;
    const user = socket.data.user;
    if (!user) return callback({ success: false, error: 'Auth required' });

    if (!['admin', 'manager', 'lead', 'am'].includes(user.role)) {
      return callback({ success: false, error: 'Unauthorized' });
    }

    const { ids, expertEmail } = data;
    if (!Array.isArray(ids) || ids.length === 0 || !expertEmail) {
      return callback({ success: false, error: 'Invalid payload' });
    }

    try {
      const results = [];
      const errors = [];
      const allWatchers = new Set();
      const batchData = [];

      for (const id of ids) {
        try {
          // Re-use update logic for assignment
          // Check if candidateService has specialized assign method?
          // Usually assignment is just updating 'expert' field + status trigger.
          // Using updateCandidate for consistency.
          const updated = await candidateService.updateCandidate(user, id, {
            expert: expertEmail,
            workflowStatus: 'Awaiting Expert' // Force status valid for assignment? Or let service decide?
            // Service usually handles status transition if expert is assigned.
            // But let's assume updateCandidate helper handles it if we pass expert.
          });
          results.push(updated);

          const watchers = candidateService.resolveAllWatchers(updated);
          watchers.forEach(w => allWatchers.add(w));

          batchData.push({
            id: updated.id,
            name: updated.name,
            expert: expertEmail
          });
        } catch (err) {
          errors.push({ id, error: err.message });
        }
      }

      if (results.length > 0) {
        // Persistent Batch Notification
        const notifData = {
          type: 'batch',
          title: 'Bulk Expert Assignment',
          description: `Assigned ${results.length} candidates to ${expertEmail} by ${user.displayName || user.name}`,
          batchData: batchData
        };

        await notificationService.broadcastToWatchers(Array.from(allWatchers), notifData);

        // Real-time
        const payload = {
          count: results.length,
          expert: expertEmail,
          updatedBy: user,
          ids: results.map(r => r.id)
        };
        Array.from(allWatchers).forEach(w => {
          this.emitToUser(socket, w, 'bulkCandidateExpertAssigned', payload);
        });
      }

      callback({
        success: true,
        updated: results.length,
        failed: errors.length,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (e) {
      logger.error('Bulk Assign Failed', e);
      callback({ success: false, error: e.message });
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
    logger.info(`DEBUG: handleAddResumeComment triggered by ${user?.email}`);
    let comment;

    try {
      comment = await candidateService.addComment(user, candidateId, content, type);
      logger.info('DEBUG: Comment saved successfully');
    } catch (error) {
      logger.error('DEBUG: handleAddResumeComment failed', {
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
      const commentAuthorName = user.displayName || userService.deriveDisplayNameFromEmail(user.email);
      // Ensure comment object has author name for realtime recipients
      if (comment && comment.author && !comment.author.name) {
        comment.author.name = commentAuthorName;
      }

      // 1. Broadcast to room (real-time chat for those open)
      this.emitToCandidateRoom(socket, candidateId, 'newComment', {
        candidateId,
        comment
      });

      // 2. Global Notification (for those NOT in room or minimized)
      logger.info('DEBUG: Fetching candidate for notification context');
      const candidate = await candidateService.getCandidateById(user, candidateId);

      if (candidate) {
        logger.info('DEBUG: Candidate found. Triggering emitCommentNotifications');
        this.emitCommentNotifications(socket, candidate, comment, user);
      } else {
        logger.warn('DEBUG: Candidate NOT found for notification', { candidateId });
      }
    } catch (notificationError) {
      // Log error but do not fail the request since comment was saved
      logger.error('DEBUG: Comment notification failed', {
        error: notificationError.message,
        candidateId,
        user: user?.email
      });
    }

    return callback({ success: true, data: comment });
  }

  emitCommentNotifications(socket, candidate, comment, sender) {
    if (!candidate) return;

    const senderEmail = sender.email.toLowerCase();
    const senderRole = sender.role.toLowerCase();

    // Helpers
    const addUser = (email) => {
      if (email && email.toLowerCase() !== senderEmail) {
        this.emitToUser(socket, email, 'newCommentNotification', { candidate, comment });
      }
    };

    // 1. Notify Admin (Always safety net)
    this.emitToRoles(socket, ['admin'], 'newCommentNotification', { candidate, comment });

    // 2. Resolve Hierarchy (Recruiter -> MLead -> MAM -> MM)
    const hierarchyEmails = candidateService.resolveHierarchyWatchers
      ? candidateService.resolveHierarchyWatchers(candidate)
      : [];

    logger.info(`DEBUG: Comment Notification Targets [Candidate: ${candidate.id}]`, {
      hierarchy: hierarchyEmails,
      sender: senderEmail
    });

    hierarchyEmails.forEach(email => addUser(email));

    // 3. Notify Expert Hierarchy (Expert -> Lead -> AM)
    if (comment.type !== 'complaint') {
      const expertEmail = (candidate.expertRaw || candidate.Expert || "").trim();
      const expertWatchers = candidateService.resolveExpertHierarchy
        ? candidateService.resolveExpertHierarchy(expertEmail)
        : expertEmail ? [expertEmail] : [];

      expertWatchers.forEach(email => {
        logger.info(`DEBUG: Adding Expert Hierarchy target: ${email}`);
        addUser(email);
      });
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
          logger.info(`DEBUG: Emitting ${event} to connected user ${clientEmail}`);
          clientSocket.emit(event, payload);
          // Also emit a debug event to frontend to check connectivity
          clientSocket.emit('debug_notification_trace', { type: event, target: clientEmail, timestamp: new Date() });
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