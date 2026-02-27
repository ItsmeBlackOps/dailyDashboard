import { taskService } from '../services/taskService.js';
import { reportAgentService } from '../services/reportAgentService.js';
import { validateTasksQuery, validateDashboardQuery, sanitizeObject } from '../middleware/validation.js';
import { socketAsyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

export class TaskSocketHandler {
  constructor() {
    this.taskService = taskService;
  }

  handleConnection(socket) {
    logger.debug('Task socket handler connected', { socketId: socket.id });

    socket.on('getTasksToday', socketAsyncHandler(this.handleGetTasksToday.bind(this)));
    socket.on('getDashboardSummary', socketAsyncHandler(this.handleGetDashboardSummary.bind(this)));
    socket.on('getTasksByRange', socketAsyncHandler(this.handleGetTasksByRange.bind(this)));
    socket.on('getTaskById', socketAsyncHandler(this.handleGetTaskById.bind(this)));
    socket.on('searchTasks', socketAsyncHandler(this.handleSearchTasks.bind(this)));
    socket.on('getTaskStatistics', socketAsyncHandler(this.handleGetTaskStatistics.bind(this)));
    socket.on('reportBotQuery', socketAsyncHandler(this.handleReportBotQuery.bind(this)));
    socket.on('reportBotDownload', socketAsyncHandler(this.handleReportBotDownload.bind(this)));
    socket.on('enrichTranscripts', socketAsyncHandler(this.handleEnrichTranscripts.bind(this)));
  }

  async handleGetTasksToday(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('GetTasksToday callback not provided', { socketId: socket.id });
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
      const validation = validateTasksQuery(sanitizedData);

      if (!validation.isValid) {
        logger.warn('Tasks query validation failed', {
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

      const { tab = "Date of Interview", targetDate } = sanitizedData;
      const resolvedTargetDate = targetDate || new Date().toISOString();

      logger.debug('Getting tasks for user via socket', {
        userEmail: user.email,
        userRole: user.role,
        tab,
        targetDate: resolvedTargetDate,
        socketId: socket.id
      });

      const result = await this.taskService.getTasksForUser(
        user.email,
        user.role,
        user.teamLead,
        user.manager,
        tab,
        resolvedTargetDate
      );

      logger.info('Tasks retrieved via socket', {
        userEmail: user.email,
        taskCount: result.tasks.length,
        tab,
        socketId: socket.id
      });

      callback(result);

    } catch (error) {
      logger.error('Socket getTasksToday failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      callback({
        success: false,
        error: error.message
      });
    }
  }

  async handleGetDashboardSummary(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('GetDashboardSummary callback not provided', { socketId: socket.id });
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
      const validation = validateDashboardQuery(sanitizedData);

      if (!validation.isValid) {
        logger.warn('Dashboard query validation failed', {
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

      const { start, end, range, dateField, upcoming } = sanitizedData;

      logger.debug('Getting dashboard summary via socket', {
        userEmail: user.email,
        userRole: user.role,
        payload: { start, end, range, dateField },
        socketId: socket.id
      });

      const result = await this.taskService.getDashboardSummary(
        user.email,
        user.role,
        user.teamLead,
        user.manager,
        {
          start,
          end,
          range,
          dateField,
          upcoming
        }
      );

      logger.info('Dashboard summary retrieved via socket', {
        userEmail: user.email,
        summaryCount: result.summary.length,
        payload: { start, end, range, dateField, upcoming },
        socketId: socket.id
      });

      callback(result);

    } catch (error) {
      logger.error('Socket getDashboardSummary failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      callback({
        success: false,
        error: error.message
      });
    }
  }

  async handleGetTasksByRange(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('getTasksByRange callback not provided', { socketId: socket.id });
        return;
      }

      const user = socket.data.user;
      if (!user) {
        return callback({ success: false, error: 'Authentication required' });
      }

      const sanitizedData = sanitizeObject(data || {});
      const validation = validateDashboardQuery(sanitizedData);

      if (!validation.isValid) {
        logger.warn('Tasks range query validation failed', {
          errors: validation.errors,
          socketId: socket.id,
          userEmail: user.email
        });
        return callback({ success: false, error: 'Validation failed', details: validation.errors });
      }

      const { start, end, range, dateField, upcoming, limit, offset } = sanitizedData;

      logger.debug('Getting tasks by range via socket', {
        userEmail: user.email,
        payload: { start, end, range, dateField, upcoming, limit, offset },
        socketId: socket.id
      });

      const result = await this.taskService.getTasksByRange(
        user.email,
        user.role,
        user.teamLead,
        user.manager,
        {
          start,
          end,
          range,
          dateField,
          upcoming,
          limit: typeof limit === 'number' ? limit : undefined,
          offset: typeof offset === 'number' ? offset : undefined
        }
      );

      logger.info('Tasks by range retrieved via socket', {
        userEmail: user.email,
        count: result.meta?.count || 0,
        socketId: socket.id
      });

      callback(result);

      // Deferred: run Appwrite transcript enrichment in the background and push
      // the result back without blocking the initial render.
      if (result.success && result.tasks?.length > 0) {
        this._pushTranscriptEnrichment(socket, result.tasks).catch(err => {
          logger.warn('Deferred transcript enrichment failed', { error: err.message, socketId: socket.id });
        });
      }
    } catch (error) {
      logger.error('Socket getTasksByRange failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });
      callback({ success: false, error: error.message });
    }
  }

  async handleGetTaskById(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('GetTaskById callback not provided', { socketId: socket.id });
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
      const { taskId } = sanitizedData;

      if (!taskId) {
        return callback({
          success: false,
          error: 'Task ID is required'
        });
      }

      logger.debug('Getting task by ID via socket', {
        userEmail: user.email,
        taskId,
        socketId: socket.id
      });

      const result = await this.taskService.getTaskById(
        taskId,
        user.email,
        user.role,
        user.teamLead,
        user.manager
      );

      logger.info('Task retrieved by ID via socket', {
        userEmail: user.email,
        taskId,
        socketId: socket.id
      });

      callback(result);

    } catch (error) {
      logger.error('Socket getTaskById failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email,
        taskId: data?.taskId
      });

      callback({
        success: false,
        error: error.message
      });
    }
  }

  async handleSearchTasks(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('SearchTasks callback not provided', { socketId: socket.id });
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

      logger.debug('Searching tasks via socket', {
        userEmail: user.email,
        searchCriteria: sanitizedData,
        socketId: socket.id
      });

      const result = await this.taskService.searchTasks(
        user.email,
        user.role,
        user.teamLead,
        user.manager,
        sanitizedData
      );

      logger.info('Task search completed via socket', {
        userEmail: user.email,
        resultCount: result.tasks.length,
        socketId: socket.id
      });

      callback(result);

    } catch (error) {
      logger.error('Socket searchTasks failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      callback({
        success: false,
        error: error.message
      });
    }
  }

  async handleGetTaskStatistics(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('GetTaskStatistics callback not provided', { socketId: socket.id });
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
      const validation = validateDashboardQuery(sanitizedData);

      if (!validation.isValid) {
        return callback({
          success: false,
          error: 'Validation failed',
          details: validation.errors
        });
      }

      const { start, end } = sanitizedData;

      logger.debug('Getting task statistics via socket', {
        userEmail: user.email,
        dateRange: { start, end },
        socketId: socket.id
      });

      const result = await this.taskService.getTaskStatistics(
        user.email,
        user.role,
        user.teamLead,
        user.manager,
        start,
        end
      );

      logger.info('Task statistics retrieved via socket', {
        userEmail: user.email,
        dateRange: { start, end },
        socketId: socket.id
      });

      callback(result);

    } catch (error) {
      logger.error('Socket getTaskStatistics failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      callback({
        success: false,
        error: error.message
      });
    }
  }

  // Handle real-time task updates
  emitTaskUpdate(socket, task, event = 'taskUpdated') {
    try {
      const user = socket.data.user;
      if (!user) return;

      if (this.taskService.checkTaskAccess(task, user.email, user.role, user.teamLead, user.manager)) {
        socket.emit(event, task);

        logger.debug('Task update emitted', {
          event,
          userEmail: user.email,
          taskId: task._id,
          socketId: socket.id
        });
      }
    } catch (error) {
      logger.error('Failed to emit task update', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });
    }
  }

  // Broadcast task updates to all relevant sockets
  broadcastTaskUpdate(io, task, event = 'taskUpdated') {
    try {
      for (const socket of io.of("/").sockets.values()) {
        this.emitTaskUpdate(socket, task, event);
      }

      logger.debug('Task update broadcasted', {
        event,
        taskId: task._id,
        assignedEmail: task.assignedEmail
      });
    } catch (error) {
      logger.error('Failed to broadcast task update', {
        error: error.message,
        taskId: task._id
      });
    }
  }

  async handleReportBotQuery(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('reportBotQuery callback not provided', { socketId: socket.id });
        return;
      }

      const user = socket.data.user;
      if (!user) {
        return callback({ success: false, error: 'Authentication required' });
      }

      const sanitizedData = sanitizeObject(data || {});
      const message = typeof sanitizedData.message === 'string' ? sanitizedData.message.trim() : '';
      const limit = sanitizedData.limit;

      if (!message) {
        return callback({ success: false, error: 'Please provide a query message.' });
      }

      logger.debug('Report bot query received', {
        userEmail: user.email,
        role: user.role,
        socketId: socket.id
      });

      const result = await reportAgentService.generateReport(user, message, { limit });

      callback(result);
    } catch (error) {
      logger.error('Report bot query failed', {
        error: error.message,
        stack: error.stack,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      const message = error.message?.includes('timed out')
        ? 'The assistant took too long to respond. Please try again shortly.'
        : error.message || 'Unable to generate the requested report.';

      callback({ success: false, error: message });
    }
  }

  async handleReportBotDownload(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('reportBotDownload callback not provided', { socketId: socket.id });
        return;
      }

      const user = socket.data.user;
      if (!user) {
        return callback({ success: false, error: 'Authentication required' });
      }

      const sanitizedData = sanitizeObject(data || {});
      const token = typeof sanitizedData.token === 'string' ? sanitizedData.token.trim() : '';

      if (!token) {
        return callback({ success: false, error: 'Download token is required' });
      }

      logger.debug('Report bot download requested', {
        userEmail: user.email,
        socketId: socket.id
      });

      const result = await reportAgentService.generateDownload(user, token);

      callback(result);
    } catch (error) {
      logger.error('Report bot download failed', {
        error: error.message,
        stack: error.stack,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      const message = error.message?.includes('timed out')
        ? 'Preparing the download timed out. Please try again.'
        : error.message || 'Unable to prepare the download.';

      callback({ success: false, error: message });
    }
  }

  /**
   * Run transcript enrichment in background and push result to the socket.
   * Emits 'transcriptsEnriched' with a { taskId => boolean } map so the
   * frontend can patch its local state without a full reload.
   */
  async _pushTranscriptEnrichment(socket, tasks) {
    const enriched = await this.taskService.enrichTranscriptsForTasks(tasks);
    const transcriptMap = {};
    for (const t of enriched) {
      if (t._id) transcriptMap[String(t._id)] = Boolean(t.transcription);
    }
    if (Object.keys(transcriptMap).length > 0) {
      socket.emit('transcriptsEnriched', { transcriptMap });
      logger.debug('Pushed transcript enrichment', {
        count: Object.keys(transcriptMap).length,
        socketId: socket.id
      });
    }
  }

  /**
   * On-demand enrichment for a specific set of task subjects.
   * Frontend emits { tasks: [{ _id, subject }] } and gets back a transcript map.
   */
  async handleEnrichTranscripts(socket, data, callback) {
    if (!callback || typeof callback !== 'function') return;

    const user = socket.data.user;
    if (!user) return callback({ success: false, error: 'Authentication required' });

    try {
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
      if (tasks.length === 0) return callback({ success: true, transcriptMap: {} });

      const enriched = await this.taskService.enrichTranscriptsForTasks(tasks);
      const transcriptMap = {};
      for (const t of enriched) {
        if (t._id) transcriptMap[String(t._id)] = Boolean(t.transcription);
      }

      callback({ success: true, transcriptMap });
    } catch (error) {
      logger.error('Socket enrichTranscripts failed', { error: error.message, socketId: socket.id });
      callback({ success: false, error: error.message });
    }
  }
}

export const taskSocketHandler = new TaskSocketHandler();
