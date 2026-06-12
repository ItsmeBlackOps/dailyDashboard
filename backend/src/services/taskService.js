import moment from 'moment-timezone';
import { ObjectId } from 'mongodb';
import { taskModel, TASK_EXCLUDE_HEAVY } from '../models/Task.js';
import { userModel } from '../models/User.js';
import { userService } from './userService.js';
import { logger, createTimer } from '../utils/logger.js';

const TIMEZONE = 'America/New_York';
const RECEIVED_DATE_FIELD_ROLES = new Set(['admin', 'mm', 'mam', 'mlead', 'recruiter']);
const RECRUITMENT_MANAGER_ROLES = new Set(['mm', 'mam', 'mlead']);
const EXPERT_MANAGER_ROLES = new Set(['am', 'lead']);
// const TOP_PERFORMER_LIMIT = 25;

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class TaskService {
  constructor() {
    this.taskModel = taskModel;
    this.userModel = userModel;
    this.userService = userService;
  }

  async getTasksForUser(userEmail, userRole, teamLead, manager, tab = "Date of Interview", targetDate, options = {}) {
    const timer = createTimer('taskService.getTasksForUser', logger);
    try {
      logger.debug('Getting tasks for user', { userEmail, userRole, tab, targetDate, options });

      const visibilityScope = this.resolveTaskVisibilityScope(userEmail, userRole);
      const teamEmails = visibilityScope.emails;

      // Coverage grants TO this viewer (task hand-offs, day grants,
      // dashboard windows) widen the model's in-memory visibility filter.
      const delegations = await this.resolveDelegatedCoverage(userEmail);

      const tasks = await this.taskModel.getTasksForUser(
        userEmail,
        userRole,
        teamEmails,
        manager,
        tab,
        targetDate,
        { ...options, delegations }
      );

      logger.info('Tasks retrieved for user', {
        userEmail,
        taskCount: tasks.length,
        tab
      });

      return {
        success: true,
        tasks,
        meta: {
          count: tasks.length,
          tab,
          userRole,
          teamSize: teamEmails.length
        }
      };
    } catch (error) {
      logger.error('Failed to get tasks for user', {
        error: error.message,
        userEmail,
        userRole
      });
      throw error;
    } finally {
      timer.end({ userEmail, userRole, tab });
    }
  }

  async getTasksByRange(userEmail, userRole, teamLead, manager, options = {}) {
    const timer = createTimer('taskService.getTasksByRange', logger);
    try {
      const {
        range = 'day',
        start,
        end,
        dateField,
        upcoming = false,
        limit,
        offset
      } = options || {};

      const effectiveDateField = this.resolveDateField(userRole, dateField);
      let { startIso, endIso, rangeUsed } = this.resolveDateRange(range, start, end);

      if (upcoming) {
        const now = moment.tz(TIMEZONE);
        const startOfTomorrow = now.clone().startOf('day').add(1, 'day');
        startIso = startOfTomorrow.toISOString();
        endIso = undefined;
        rangeUsed = 'upcoming';
      }

      logger.debug('Getting tasks by range (Aggregation)', {
        userEmail,
        userRole,
        dateField: effectiveDateField,
        range: rangeUsed,
        requested: { start, end, dateField, range, upcoming, limit, offset }
      });

      const visibilityScope = this.resolveTaskVisibilityScope(userEmail, userRole);

      // 1. Initial Match (Criteria)
      const initialMatch = {};

      // Date Logic for Pipeline
      // effectiveDateField is usually 'Date of Interview' or 'receivedDateTime'.
      //
      // SP3/DASH-S1 — the interview-date path now filters on the indexed BSON
      // Date `interviewStartAt` instead of a $dateFromString parse of the
      // "Date of Interview" MM/DD/YYYY string. The old $expr approach forced a
      // full collection scan (computed field can't use an index) AND silently
      // dropped rows whose string failed to parse. `startIso`/`endIso` are
      // already Eastern-anchored UTC instants (resolveDateRange uses
      // moment.tz(America/New_York)), so this range is timezone-identical to
      // the prior match; the ~0.4% of tasks without interviewStartAt are
      // exactly the unparseable rows the old match already excluded.
      if (rangeUsed === 'upcoming') {
        // Upcoming Logic (interview start >= start-of-tomorrow EST). `startIso`
        // was set to EST start-of-tomorrow in the `upcoming` block above.
        initialMatch.interviewStartAt = { $gte: new Date(startIso) };
      } else {
        // Range Logic
        if (effectiveDateField === 'receivedDateTime') {
          initialMatch.receivedDateTime = {};
          if (startIso) initialMatch.receivedDateTime.$gte = startIso;
          if (endIso) initialMatch.receivedDateTime.$lte = endIso;
        } else {
          // Interview-date range on the indexed `interviewStartAt` BSON Date.
          const range = {};
          if (startIso) range.$gte = new Date(startIso);
          if (endIso) range.$lt = new Date(endIso);
          if (Object.keys(range).length > 0) {
            initialMatch.interviewStartAt = range;
          }
        }
      }

      // 2. Base Pipeline
      const pipeline = [
        { $match: initialMatch }
      ];

      // 3. Access Control (Visibility Filter) — runs BEFORE the candidate
      // lookup because it depends ONLY on task fields (sender/cc/assignedTo/
      // assignedExpert), never on the candidateDetails lookup. Filtering first
      // lets us sort + paginate the matched set and join only the page we
      // actually return (the lookup used to run over the whole date window).
      const visibilityMatch = this.buildTaskVisibilityMatch(userEmail, userRole, teamLead, manager);

      if (Object.keys(visibilityMatch).length > 0) {
        pipeline.push({ $match: visibilityMatch });
      }

      // 4. Pagination — sort on the (collation-matched) interviewStartAt index,
      // then skip/limit, BEFORE the lookup so the join touches only the returned
      // rows. `_id` is a stable secondary key when starts tie / are null.
      pipeline.push({ $sort: { interviewStartAt: 1, _id: -1 } });
      if (offset) pipeline.push({ $skip: offset });
      if (limit) pipeline.push({ $limit: limit });

      // 5. Enrich only the paginated page: join candidateDetails for the
      // candidate's Expert (candidateExpertRaw, consumed by formatTask), then
      // drop the heavy email-thread blobs (body/replies) before returning.
      pipeline.push(
        {
          $lookup: {
            from: 'candidateDetails',
            localField: 'Candidate Name',
            foreignField: 'Candidate Name',
            as: 'candidateDetails',
            pipeline: [
              { $project: { _id: 0, Expert: 1 } }
            ]
          }
        },
        {
          $addFields: {
            candidateExpertRaw: {
              $let: {
                vars: { item: { $first: '$candidateDetails' } },
                in: { $ifNull: ['$$item.Expert', null] }
              }
            }
          }
        },
        { $unset: ['replies', 'body', 'candidateDetails'] }
      );

      const collation = { locale: 'en', strength: 2 };

      const docs = await this.taskModel.collection.aggregate(pipeline, { collation }).toArray();

      const tasks = docs
        .map(task => this.taskModel.formatTask(task))
        .filter(Boolean);

      // NOTE: Transcript enrichment is deferred — call enrichTranscriptsForTasks() separately.

      logger.info('Tasks by range retrieved (Aggregated)', {
        userEmail,
        taskCount: tasks.length,
        dateRange: { startIso, endIso },
        dateField: effectiveDateField
      });

      return {
        success: true,
        tasks,
        meta: {
          count: tasks.length,
          dateRange: { startIso, endIso, range: rangeUsed },
          userRole,
          teamSize: visibilityScope.emails.length,
          dateField: effectiveDateField
        }
      };
    } catch (error) {
      logger.error('Failed to get tasks by range', {
        error: error.message,
        userEmail,
        userRole
      });
      throw error;
    } finally {
      timer.end({ userEmail, userRole, options });
    }
  }

  /**
   * Enrich an array of already-formatted tasks with Appwrite transcript status.
   * Call this AFTER returning the initial task list to the client so it doesn't
   * block the first paint.
   */
  async enrichTranscriptsForTasks(tasks) {
    return this.taskModel.enrichWithTranscriptStatus(tasks);
  }

  async getDashboardSummary(userEmail, userRole, teamLead, manager, options = {}) {
    const timer = createTimer('taskService.getDashboardSummary', logger);
    try {
      const {
        range = 'day',
        start,
        end,
        dateField,
        upcoming = false
      } = options || {};

      const effectiveDateField = this.resolveDateField(userRole, dateField);
      let { startIso, endIso, rangeUsed } = this.resolveDateRange(range, start, end);

      if (upcoming) {
        const now = moment.tz(TIMEZONE);
        const startOfTomorrow = now.clone().startOf('day').add(1, 'day');
        startIso = startOfTomorrow.toISOString();
        endIso = undefined;
        rangeUsed = 'upcoming';
      }

      logger.debug('Getting dashboard summary', {
        userEmail,
        userRole,
        dateField: effectiveDateField,
        range: rangeUsed,
        requested: { start, end, dateField, range, upcoming }
      });

      const teamEmails = this.userModel
        .getTeamEmails(userEmail, userRole, teamLead)
        .map((email) => email.toLowerCase());

      // PERF — fire both Mongo round-trips in parallel. They share the
      // same role/date match but project different fields, so neither
      // depends on the other. Halves wall-clock for whichever scan is
      // slower (typically the aggregation pipeline).
      const [summary, kpiTasks] = await Promise.all([
        this.taskModel.getDashboardSummary(
          userEmail,
          userRole,
          manager,
          teamEmails,
          startIso,
          endIso,
          effectiveDateField
        ),
        this.taskModel.getTasksForKpi(
          userEmail,
          userRole,
          manager,
          teamEmails,
          startIso,
          endIso,
          effectiveDateField
        ),
      ]);

      const kpi = this.buildKpiMetrics(kpiTasks, userRole);
      const leaders = this.buildTopPerformers(kpiTasks, userRole);

      logger.info('Dashboard summary retrieved', {
        userEmail,
        summaryCount: summary.length,
        dateRange: { startIso, endIso },
        dateField: effectiveDateField
      });

      return {
        success: true,
        summary,
        meta: {
          count: summary.length,
          dateRange: { startIso, endIso, range: rangeUsed },
          userRole,
          teamSize: teamEmails.length,
          dateField: effectiveDateField,
          kpi,
          leaders
        }
      };
    } catch (error) {
      logger.error('Failed to get dashboard summary', {
        error: error.message,
        userEmail,
        userRole
      });
      throw error;
    } finally {
      timer.end({ userEmail, userRole, options });
    }
  }

  async getTaskById(taskId, userEmail, userRole, teamLead, manager) {
    const timer = createTimer('taskService.getTaskById', logger);
    try {
      logger.debug('Getting task by ID', { taskId, userEmail });

      let filter = { _id: taskId };
      if (ObjectId.isValid(taskId)) {
        try {
          filter = { _id: new ObjectId(taskId) };
        } catch (error) {
          logger.warn('Failed to convert taskId to ObjectId, falling back to string match', {
            taskId,
            error: error.message
          });
        }
      }

      const task = await this.taskModel.collection.findOne(filter, {
        projection: TASK_EXCLUDE_HEAVY
      });

      if (!task) {
        throw new Error('Task not found');
      }

      const formattedTask = this.taskModel.formatTask(task);

      if (!formattedTask) {
        throw new Error('Invalid task data');
      }

      const hasAccess = this.checkTaskAccess(formattedTask, userEmail, userRole, teamLead, manager);

      if (!hasAccess) {
        throw new Error('Access denied');
      }

      logger.info('Task retrieved by ID', { taskId, userEmail });

      return {
        success: true,
        task: formattedTask
      };
    } catch (error) {
      logger.error('Failed to get task by ID', {
        error: error.message,
        taskId,
        userEmail
      });
      throw error;
    } finally {
      timer.end({ taskId, userEmail });
    }
  }

  async deleteTask(taskId, userEmail, userRole) {
    const timer = createTimer('taskService.deleteTask', logger);
    try {
      logger.info('Attempting to delete task', { taskId, userEmail, userRole });

      // STRICT ADMIN CHECK
      if (userRole !== 'admin') {
        logger.warn('Unauthorized delete attempt', { userEmail, userRole, taskId });
        throw new Error('Unauthorized: Only admins can delete tasks');
      }

      let filter = { _id: taskId };
      if (ObjectId.isValid(taskId)) {
        try {
          filter = { _id: new ObjectId(taskId) };
        } catch (error) {
          logger.warn('Invalid ObjectId for delete', { taskId, error: error.message });
          // Fallback to string match if simple objectid fails, though usually consistent
        }
      }

      const result = await this.taskModel.collection.deleteOne(filter);

      if (result.deletedCount === 0) {
        logger.warn('Task not found for deletion', { taskId });
        throw new Error('Task not found');
      }

      logger.info('Task deleted successfully', { taskId, userEmail });

      return {
        success: true,
        message: 'Task deleted successfully',
        taskId
      };
    } catch (error) {
      logger.error('Failed to delete task', {
        error: error.message,
        taskId,
        userEmail
      });
      throw error;
    } finally {
      timer.end({ taskId, userEmail, userRole });
    }
  }

  checkTaskAccess(task, userEmail, userRole, teamLead, manager) {
    return this.isTaskVisibleToUser(task, userEmail, userRole, teamLead, manager);
  }

  async getTaskStatistics(userEmail, userRole, teamLead, manager, startDate, endDate) {
    const timer = createTimer('taskService.getTaskStatistics', logger);
    try {
      logger.debug('Getting task statistics', {
        userEmail,
        userRole,
        dateRange: { startDate, endDate }
      });

      const teamEmails = this.userModel.getTeamEmails(userEmail, userRole, teamLead);

      const summary = await this.taskModel.getDashboardSummary(
        userEmail,
        userRole,
        manager,
        teamEmails,
        startDate,
        endDate
      );

      const statistics = this.calculateStatistics(summary);

      logger.info('Task statistics calculated', {
        userEmail,
        totalCandidates: statistics.totalCandidates
      });

      return {
        success: true,
        statistics,
        meta: {
          dateRange: { startDate, endDate },
          userRole,
          teamSize: teamEmails.length
        }
      };
    } catch (error) {
      logger.error('Failed to get task statistics', {
        error: error.message,
        userEmail,
        userRole
      });
      throw error;
    } finally {
      timer.end({ userEmail, userRole, startDate, endDate });
    }
  }

  calculateStatistics(summary) {
    const stats = {
      totalCandidates: summary.length,
      statusBreakdown: {},
      expertBreakdown: {},
      averageStatusCount: 0,
      mostActiveExpert: null,
      statusDistribution: []
    };

    let totalStatusCount = 0;
    const expertCounts = {};

    for (const item of summary) {
      const expert = item.Expert || 'Unassigned';

      if (!expertCounts[expert]) {
        expertCounts[expert] = 0;
      }
      expertCounts[expert]++;

      if (item.statusCount) {
        for (const [status, count] of Object.entries(item.statusCount)) {
          if (!stats.statusBreakdown[status]) {
            stats.statusBreakdown[status] = 0;
          }
          stats.statusBreakdown[status] += count;
          totalStatusCount += count;
        }
      }
    }

    stats.averageStatusCount = summary.length > 0 ? totalStatusCount / summary.length : 0;
    stats.expertBreakdown = expertCounts;

    const mostActive = Object.entries(expertCounts).reduce(
      (max, [expert, count]) => count > max.count ? { expert, count } : max,
      { expert: null, count: 0 }
    );

    stats.mostActiveExpert = mostActive.expert;

    stats.statusDistribution = Object.entries(stats.statusBreakdown).map(([status, count]) => ({
      status,
      count,
      percentage: totalStatusCount > 0 ? ((count / totalStatusCount) * 100).toFixed(2) : 0
    }));

    return stats;
  }

  setupRealtimeUpdates(io) {
    try {
      this.taskModel.setupChangeStream(
        io,
        this.userModel,
        (user, task) => this.checkTaskAccess(
          task,
          user?.email,
          user?.role,
          user?.teamLead,
          user?.manager
        )
      );
      logger.info('Task realtime updates configured');
    } catch (error) {
      logger.error('Failed to setup task realtime updates', { error: error.message });
      throw error;
    }
  }

  async searchTasks(userEmail, userRole, teamLead, manager, searchCriteria) {
    const timer = createTimer('taskService.searchTasks', logger);
    try {
      logger.debug('Searching tasks', { userEmail, searchCriteria });

      const {
        candidateName,
        expert,
        status,
        dateFrom,
        dateTo,
        upcoming,
        limit = 50,
        offset = 0
      } = searchCriteria;

      const visibilityScope = this.resolveTaskVisibilityScope(userEmail, userRole);

      // 1. Initial Match (Performance Optimization)
      const initialMatch = {};

      if (candidateName) {
        initialMatch['Candidate Name'] = { $regex: candidateName, $options: 'i' };
      }

      if (status) {
        initialMatch.status = status;
      }

      // Date Filters
      if (upcoming) {
        // "Upcoming" means today onwards in NYC time. SP3/DASH-S1 — filter on
        // the indexed BSON Date `interviewStartAt` instead of a $dateFromString
        // parse of the "Date of Interview" MM/DD/YYYY string. The old $expr on
        // a computed field forced a full collection scan and dropped rows whose
        // string failed to parse; this range is index-friendly and anchored to
        // Eastern start-of-day regardless of server clock.
        const todayStartEst = moment.tz(TIMEZONE).startOf('day').toDate();
        initialMatch.interviewStartAt = { $gte: todayStartEst };
      } else if (dateFrom || dateTo) {
        if (!initialMatch.receivedDateTime) initialMatch.receivedDateTime = {};
        if (dateFrom) initialMatch.receivedDateTime.$gte = dateFrom;
        if (dateTo) initialMatch.receivedDateTime.$lte = dateTo;
      }

      // 2. Base Pipeline
      const pipeline = [
        { $match: initialMatch }
      ];

      // 3. Lookups (Access Control Dependencies)
      // We need these for "Suggested" checks
      pipeline.push(
        {
          $lookup: {
            from: 'candidateDetails',
            localField: 'Candidate Name',
            foreignField: 'Candidate Name',
            as: 'candidateDetails',
            pipeline: [
              { $project: { _id: 0, Expert: 1 } }
            ]
          }
        },
        {
          $addFields: {
            candidateExpertRaw: {
              $let: {
                vars: { item: { $first: '$candidateDetails' } },
                in: { $ifNull: ['$$item.Expert', null] }
              }
            }
          }
        },
        { $unset: ['replies', 'body', 'candidateDetails'] }
      );

      // 4. Access Control (Visibility Filter)
      // This MUST be applied after lookups because it depends on candidateExpertRaw
      const visibilityMatch = this.buildTaskVisibilityMatch(userEmail, userRole, teamLead, manager);

      if (Object.keys(visibilityMatch).length > 0) {
        pipeline.push({ $match: visibilityMatch });
      }

      // 5. Pagination & Formatting
      // Sort by the indexed `interviewStartAt` (soonest first) to match the
      // Tasks list ordering; `_id` is a stable secondary key for pagination.
      pipeline.push({ $sort: { interviewStartAt: 1, _id: -1 } });
      if (offset) pipeline.push({ $skip: offset });
      if (limit) pipeline.push({ $limit: limit });

      const collation = { locale: 'en', strength: 2 }; // Case Insensitive Index Usage

      const docs = await this.taskModel.collection.aggregate(pipeline, { collation }).toArray();

      const formattedTasks = docs
        .map(task => this.taskModel.formatTask(task))
        .filter(Boolean);

      logger.info('Task search completed', {
        userEmail,
        resultCount: formattedTasks.length,
        searchCriteria
      });

      return {
        success: true,
        tasks: formattedTasks,
        meta: {
          count: formattedTasks.length,
          teamSize: visibilityScope.emails.length,
          offset,
          limit,
          searchCriteria
        }
      };
    } catch (error) {
      logger.error('Task search failed', {
        error: error.message,
        userEmail,
        searchCriteria
      });
      throw error;
    } finally {
      timer.end({ userEmail, userRole, searchCriteria });
    }
  }

  normalizeRole(userRole = '') {
    return (userRole || '').toString().trim().toLowerCase();
  }

  normalizeVisibilityToken(value = '') {
    return (value || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  resolveTaskVisibilityScope(userEmail, userRole) {
    try {
      const scope = this.userService.buildTaskHierarchyScope({ email: userEmail, role: userRole });
      if (Array.isArray(scope?.emails) && scope.emails.length > 0) {
        return scope;
      }
    } catch (error) {
      logger.warn('Failed to resolve hierarchy visibility scope, falling back to self scope', {
        userEmail,
        userRole,
        error: error.message
      });
    }

    const lowerEmail = this.normalizeVisibilityToken(userEmail);
    const local = lowerEmail.split('@')[0];
    const display = this.normalizeVisibilityToken(this.userService.deriveDisplayNameFromEmail(lowerEmail));

    return {
      emails: lowerEmail ? [lowerEmail] : [],
      locals: local ? [local] : [],
      displayNames: display ? [display] : [],
      escaped: {
        emails: lowerEmail ? [escapeRegex(lowerEmail)] : [],
        locals: local ? [escapeRegex(local)] : [],
        displayNames: display ? [escapeRegex(display)] : []
      }
    };
  }

  buildVisibilityRegexSource(scope = {}) {
    const segments = new Set([
      ...(scope?.escaped?.emails || []),
      ...(scope?.escaped?.locals || []),
      ...(scope?.escaped?.displayNames || [])
    ]);

    return Array.from(segments).filter(Boolean).join('|');
  }

  buildContainsRegexMatch(fields = [], regexSource = '') {
    if (!regexSource) {
      return {};
    }

    return {
      $or: fields.map((field) => ({
        [field]: { $regex: regexSource, $options: 'i' }
      }))
    };
  }

  buildAssignedScopeMatch(scope = {}) {
    const fields = ['assignedTo', 'assignedToEmail', 'assignedEmail', 'assignedExpert'];
    const conditions = [];

    if (Array.isArray(scope.emails) && scope.emails.length > 0) {
      for (const field of fields) {
        conditions.push({ [field]: { $in: scope.emails } });
      }
    }

    const regexSource = this.buildVisibilityRegexSource(scope);
    if (regexSource) {
      for (const field of fields) {
        conditions.push({ [field]: { $regex: regexSource, $options: 'i' } });
      }
    }

    if (conditions.length === 0) {
      return {};
    }

    return { $or: conditions };
  }

  buildRecruiterVisibilityMatch(userEmail) {
    const lowerEmail = this.normalizeVisibilityToken(userEmail);
    const localPart = lowerEmail.split('@')[0];
    const recruiterDisplay = this.normalizeVisibilityToken(this.userService.deriveDisplayNameFromEmail(lowerEmail));

    return {
      $or: [
        { sender: { $regex: escapeRegex(localPart), $options: 'i' } },
        { sender: { $regex: escapeRegex(lowerEmail), $options: 'i' } },
        { cc: { $regex: escapeRegex(localPart), $options: 'i' } },
        { to: { $regex: escapeRegex(localPart), $options: 'i' } },
        { assignedTo: { $regex: `^${escapeRegex(localPart)}$`, $options: 'i' } },
        { assignedTo: { $regex: `^${escapeRegex(lowerEmail)}$`, $options: 'i' } },
        { assignedToEmail: { $regex: `^${escapeRegex(lowerEmail)}$`, $options: 'i' } },
        { assignedEmail: { $regex: `^${escapeRegex(lowerEmail)}$`, $options: 'i' } },
        { assignedExpert: { $regex: `^${escapeRegex(recruiterDisplay)}$`, $options: 'i' } }
      ]
    };
  }

  buildIndividualVisibilityMatch(userEmail) {
    const lowerEmail = this.normalizeVisibilityToken(userEmail);
    const localPart = lowerEmail.split('@')[0];
    const displayName = this.normalizeVisibilityToken(this.userService.deriveDisplayNameFromEmail(lowerEmail));

    return {
      $or: [
        { assignedTo: { $regex: `^${escapeRegex(localPart)}$`, $options: 'i' } },
        { assignedTo: { $regex: `^${escapeRegex(lowerEmail)}$`, $options: 'i' } },
        { assignedToEmail: { $regex: `^${escapeRegex(lowerEmail)}$`, $options: 'i' } },
        { assignedEmail: { $regex: `^${escapeRegex(lowerEmail)}$`, $options: 'i' } },
        { assignedExpert: { $regex: `^${escapeRegex(displayName)}$`, $options: 'i' } }
      ]
    };
  }

  buildTaskVisibilityMatch(userEmail, userRole, teamLead, manager) {
    const normalizedRole = this.normalizeRole(userRole);

    if (normalizedRole === 'admin') {
      return {};
    }

    if (RECRUITMENT_MANAGER_ROLES.has(normalizedRole)) {
      const scope = this.resolveTaskVisibilityScope(userEmail, userRole);
      const regexSource = this.buildVisibilityRegexSource(scope);
      const match = this.buildContainsRegexMatch(['sender', 'cc'], regexSource);

      logger.debug('Task visibility match built', {
        userEmail,
        userRole: normalizedRole,
        family: 'recruitment-manager',
        fields: ['sender', 'cc'],
        scopeSize: scope.emails.length
      });

      return match;
    }

    if (EXPERT_MANAGER_ROLES.has(normalizedRole)) {
      const scope = this.resolveTaskVisibilityScope(userEmail, userRole);
      const match = this.buildAssignedScopeMatch(scope);

      logger.debug('Task visibility match built', {
        userEmail,
        userRole: normalizedRole,
        family: 'expert-manager',
        fields: ['assignedTo', 'assignedToEmail', 'assignedEmail', 'assignedExpert'],
        scopeSize: scope.emails.length
      });

      return match;
    }

    if (normalizedRole === 'recruiter') {
      return this.buildRecruiterVisibilityMatch(userEmail);
    }

    return this.buildIndividualVisibilityMatch(userEmail);
  }

  buildSearchQuery(userEmail, userRole, manager, teamEmails) {
    return this.buildTaskVisibilityMatch(userEmail, userRole);
  }

  fieldContainsAnyToken(value, tokens) {
    if (!value || !tokens || tokens.size === 0) {
      return false;
    }

    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      const normalizedEntry = this.normalizeVisibilityToken(entry);
      if (!normalizedEntry) continue;

      for (const token of tokens) {
        if (!token) continue;
        if (normalizedEntry === token || normalizedEntry.includes(token)) {
          return true;
        }
      }
    }

    return false;
  }

  taskMatchesScopeFields(task, fields, scope) {
    const tokens = new Set(
      [
        ...(scope?.emails || []),
        ...(scope?.locals || []),
        ...(scope?.displayNames || [])
      ]
        .map((value) => this.normalizeVisibilityToken(value))
        .filter(Boolean)
    );

    if (tokens.size === 0) {
      return false;
    }

    return fields.some((field) => this.fieldContainsAnyToken(task?.[field], tokens));
  }

  isTaskVisibleToUser(task, userEmail, userRole, teamLead, manager) {
    if (!task || !userEmail) {
      return false;
    }

    const normalizedRole = this.normalizeRole(userRole);
    const lowerEmail = this.normalizeVisibilityToken(userEmail);

    if (normalizedRole === 'admin') {
      return true;
    }

    if (RECRUITMENT_MANAGER_ROLES.has(normalizedRole)) {
      const scope = this.resolveTaskVisibilityScope(userEmail, userRole);
      return this.taskMatchesScopeFields(task, ['sender', 'cc'], scope);
    }

    if (EXPERT_MANAGER_ROLES.has(normalizedRole)) {
      const scope = this.resolveTaskVisibilityScope(userEmail, userRole);
      return this.taskMatchesScopeFields(
        task,
        ['assignedTo', 'assignedToEmail', 'assignedEmail', 'assignedExpert'],
        scope
      );
    }

    if (normalizedRole === 'recruiter') {
      const localPart = lowerEmail.split('@')[0];
      const displayName = this.normalizeVisibilityToken(this.userService.deriveDisplayNameFromEmail(lowerEmail));
      const haystack = [task.sender, task.cc, task.to, task.assignedTo, task.assignedToEmail, task.assignedEmail, task.assignedExpert]
        .filter(Boolean)
        .map((value) => value.toString().toLowerCase())
        .join(' ');

      return haystack.includes(lowerEmail) || haystack.includes(localPart) || (displayName && haystack.includes(displayName));
    }

    const selfScope = this.resolveTaskVisibilityScope(userEmail, 'user');
    return this.taskMatchesScopeFields(
      task,
      ['assignedTo', 'assignedToEmail', 'assignedEmail', 'assignedExpert'],
      selfScope
    );
  }

  buildKpiMetrics(tasks, userRole) {
    const now = moment.tz(TIMEZONE);
    const startOfDay = now.clone().startOf('day');
    const startOfWeek = now.clone().startOf('week');
    const startOfMonth = now.clone().startOf('month');

    const kpi = {
      totals: {
        overall: tasks.length,
        byRound: {}
      },
      received: {
        today: 0,
        thisWeek: 0,
        thisMonth: 0
      },
      interview: {
        today: 0,
        thisWeek: 0,
        thisMonth: 0
      }
    };

    const branchCounts = {};
    const roundByBranch = {};

    for (const task of tasks) {
      const round = this.normalizeRoundValue(task.actualRound);
      kpi.totals.byRound[round] = (kpi.totals.byRound[round] || 0) + 1;

      if (task.receivedDateTime) {
        const receivedMoment = moment.tz(task.receivedDateTime, 'America/New_York');
        if (receivedMoment.isValid()) {
          if (receivedMoment.isSameOrAfter(startOfDay)) {
            kpi.received.today += 1;
          }
          if (receivedMoment.isSameOrAfter(startOfWeek)) {
            kpi.received.thisWeek += 1;
          }
          if (receivedMoment.isSameOrAfter(startOfMonth)) {
            kpi.received.thisMonth += 1;
          }
        }
      }

      const interviewDate = task['Date of Interview'];
      if (interviewDate) {
        const interviewMoment = moment.tz(interviewDate, ['MM/DD/YYYY'], 'America/New_York');
        if (interviewMoment.isValid()) {
          if (interviewMoment.isSameOrAfter(startOfDay, 'day')) {
            kpi.interview.today += 1;
          }
          if (interviewMoment.isSameOrAfter(startOfWeek, 'week')) {
            kpi.interview.thisWeek += 1;
          }
          if (interviewMoment.isSameOrAfter(startOfMonth, 'month')) {
            kpi.interview.thisMonth += 1;
          }
        }
      }

      if (userRole === 'admin') {
        const branch = this.determineBranch(task);
        branchCounts[branch] = (branchCounts[branch] || 0) + 1;
        if (!roundByBranch[branch]) roundByBranch[branch] = {};
        roundByBranch[branch][round] = (roundByBranch[branch][round] || 0) + 1;
      }
    }

    if (userRole === 'admin') {
      kpi.branch = branchCounts;
      kpi.roundByBranch = roundByBranch;
    }

    return kpi;
  }

  determineBranch(task) {
    const haystack = [task.cc, task.to, task.assignedTo, task.assignedExpert]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (haystack.includes('tushar.ahuja')) {
      return 'GGR';
    }
    if (haystack.includes('aryan.mishra')) {
      return 'LKN';
    }
    if (haystack.includes('akash.avasthi')) {
      return 'AHM';
    }
    if (haystack.includes('flawless')) {
      return 'FeD';
    }

    return 'Other';
  }

  resolveDateField(userRole, requestedField) {
    const normalizedRole = (userRole || '').toLowerCase();

    if (requestedField === 'receivedDateTime' && RECEIVED_DATE_FIELD_ROLES.has(normalizedRole)) {
      return 'receivedDateTime';
    }

    if (requestedField && requestedField !== 'Date of Interview' && requestedField !== 'receivedDateTime') {
      logger.warn('Unsupported dateField requested, defaulting to Date of Interview', {
        requestedField,
        userRole
      });
    }

    if (requestedField === 'receivedDateTime' && !RECEIVED_DATE_FIELD_ROLES.has(normalizedRole)) {
      logger.warn('User not allowed to query by receivedDateTime, defaulting to Date of Interview', {
        userRole
      });
    }

    return 'Date of Interview';
  }

  resolveDateRange(range, start, end) {
    const now = moment.tz(TIMEZONE);
    let startMoment;
    let endMoment;
    let rangeUsed = range;

    const parseExplicitRange = () => {
      if (!start || !end) {
        return null;
      }

      const startCandidate = moment(start, moment.ISO_8601, true);
      const endCandidate = moment(end, moment.ISO_8601, true);

      if (!startCandidate.isValid() || !endCandidate.isValid()) {
        return null;
      }

      if (!startCandidate.isBefore(endCandidate)) {
        return null;
      }

      return {
        startMoment: startCandidate.clone().tz(TIMEZONE),
        endMoment: endCandidate.clone().tz(TIMEZONE)
      };
    };

    const explicitRange = parseExplicitRange();

    switch (range) {
      case 'week':
      case 'month':
      case 'day':
        if (explicitRange) {
          ({ startMoment, endMoment } = explicitRange);
          break;
        }
        if (range === 'week') {
          startMoment = now.clone().startOf('week');
          endMoment = startMoment.clone().add(1, 'week');
        } else if (range === 'month') {
          startMoment = now.clone().startOf('month');
          endMoment = startMoment.clone().add(1, 'month');
        } else {
          rangeUsed = 'day';
          startMoment = now.clone().startOf('day');
          endMoment = startMoment.clone().add(1, 'day');
        }
        break;
      case 'custom':
        if (explicitRange) {
          startMoment = explicitRange.startMoment.clone().startOf('day');
          endMoment = explicitRange.endMoment.clone().endOf('day').add(1, 'millisecond');
          break;
        }

        logger.warn('Invalid custom range supplied, falling back to day range', {
          start,
          end
        });
        rangeUsed = 'day';
        startMoment = now.clone().startOf('day');
        endMoment = startMoment.clone().add(1, 'day');
        break;
      default:
        rangeUsed = 'day';
        startMoment = now.clone().startOf('day');
        endMoment = startMoment.clone().add(1, 'day');
        break;
    }

    return {
      startIso: startMoment.toISOString(),
      endIso: endMoment.toISOString(),
      rangeUsed
    };
  }

  normalizeRoundValue(roundValue) {
    const raw = (roundValue ?? '').toString().replace(/\u00A0/g, ' ').trim();
    if (!raw) return 'Unknown';
    return raw.replace(/\s+/g, ' ');
  }

  formatDisplayName(value, fallback = 'Unknown') {
    if (!value) return fallback;
    const trimmed = value.toString().trim();
    if (!trimmed) return fallback;
    if (trimmed.includes('@')) {
      const localPart = trimmed.split('@')[0];
      return localPart
        .split(/[._\s-]+/)
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
        .join(' ');
    }
    return trimmed;
  }

  buildTopPerformers(tasks, userRole) {
    const expertMap = new Map();
    const recruiterMap = new Map();
    const candidateMap = new Map();

    for (const task of tasks) {
      const roundLabel = this.normalizeRoundValue(task.actualRound);

      const expertEmail = (task.assignedToEmail || task.assignedTo || '').toLowerCase();
      const expertName = this.formatDisplayName(task.assignedExpert || expertEmail, 'Not Assigned');
      this.accumulateLeader(expertMap, expertEmail || expertName.toLowerCase(), expertName, roundLabel);

      const recruiterEmail = (task.sender || '').toLowerCase();
      const recruiterName = this.formatDisplayName(task.sender, 'Unknown');
      this.accumulateLeader(recruiterMap, recruiterEmail || recruiterName.toLowerCase(), recruiterName, roundLabel);

      const candidateName = this.formatDisplayName(task['Candidate Name'], 'Unknown');
      this.accumulateLeader(candidateMap, candidateName.toLowerCase(), candidateName, roundLabel);
    }

    return {
      expert: this.mapToLeaderArray(expertMap, 'expert', userRole),
      recruiter: this.mapToLeaderArray(recruiterMap, 'recruiter', userRole),
      candidate: this.mapToLeaderArray(candidateMap, 'candidate', userRole)
    };
  }

  accumulateLeader(map, id, name, roundLabel) {
    if (!map.has(id)) {
      map.set(id, {
        id,
        name,
        counts: {}
      });
    }

    const entry = map.get(id);
    entry.counts[roundLabel] = (entry.counts[roundLabel] || 0) + 1;
  }

  mapToLeaderArray(map, view, userRole) {
    const leaders = Array.from(map.values()).map((entry) => {
      const total = Object.values(entry.counts).reduce((sum, value) => sum + value, 0);
      return {
        ...entry,
        total,
        highlight: this.shouldHighlightLeader(view, userRole, total)
      };
    });

    leaders.sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return a.name.localeCompare(b.name);
    });

    return leaders;
  }

  shouldHighlightLeader(view, userRole, total) {
    if (['MM', 'MAM', 'mlead'].includes(userRole)) {
      return total < 5;
    }

    if (['lead', 'admin', 'user'].includes(userRole)) {
      return total >= 5;
    }

    return false;
  }

  // Tasks starting within the next `windowMinutes` (plus a short overdue
  // grace window) that nobody has marked started yet — feeds the dashboard
  // "Starting soon" strip. Deliberately unscoped by role: every dashboard
  // shows the same list so anyone can chase a missed start. Uses the
  // indexed BSON Date `interviewStartAt` (SP3), so the scan is a tight
  // range seek.
  async getUpcomingUnstarted(windowMinutes = 20, graceMinutes = 15) {
    const collection = this.taskModel.collection;
    if (!collection) {
      return { success: true, tasks: [], windowMinutes, graceMinutes };
    }

    const now = Date.now();
    const from = new Date(now - graceMinutes * 60 * 1000);
    const to = new Date(now + windowMinutes * 60 * 1000);

    const docs = await collection
      .find(
        {
          interviewStartAt: { $gte: from, $lte: to },
          meetingStarted: { $ne: true },
          // Mock-interview rows (future Mock Support work) never belong in
          // the interview-ops strip.
          taskType: { $ne: 'mock' },
        },
        {
          projection: {
            'Candidate Name': 1,
            'Job Title': 1,
            'End Client': 1,
            'Interview Round': 1,
            status: 1,
            interviewStartAt: 1,
            assignedTo: 1,
            assignedExpert: 1,
            meetingLink: 1,
            joinUrl: 1,
            joinWebUrl: 1,
          },
        }
      )
      .sort({ interviewStartAt: 1 })
      .limit(25)
      .toArray();

    // Status strings in taskBody are mixed-case; filter in JS rather than
    // with a case-insensitive $nin (the window holds at most a handful of
    // rows).
    const INACTIVE = new Set(['cancelled', 'completed', 'done', 'selected', 'rejected']);
    const tasks = docs
      .filter((d) => !INACTIVE.has(String(d.status || '').toLowerCase()))
      .map((d) => ({
        taskId: d._id.toString(),
        candidateName: d['Candidate Name'] || '',
        role: d['Job Title'] || '',
        client: d['End Client'] || '',
        round: d['Interview Round'] || '',
        status: d.status || '',
        interviewStartAt: d.interviewStartAt ? new Date(d.interviewStartAt).toISOString() : null,
        interviewStartEst: d.interviewStartAt
          ? moment(d.interviewStartAt).tz(TIMEZONE).format('h:mm A')
          : null,
        assignedTo: d.assignedTo || d.assignedExpert || '',
        hasMeetingLink: Boolean(d.meetingLink || d.joinUrl || d.joinWebUrl),
      }));

    return { success: true, tasks, windowMinutes, graceMinutes };
  }

  // ── Delegated coverage + co-assignees ────────────────────────────────

  /**
   * Active coverage grants where this user is the delegate, reshaped for
   * the model's visibility filter. Null when there are none (the common
   * case) so the model skips the extra checks entirely.
   */
  async resolveDelegatedCoverage(userEmail) {
    try {
      const { delegationService } = await import('./delegationService.js');
      const grants = await delegationService.listActiveForUser(userEmail);
      if (!Array.isArray(grants) || grants.length === 0) return null;
      const taskIdSet = new Set();
      const dayGrants = [];
      const windowOwners = new Set();
      for (const g of grants) {
        if (g.scope === 'tasks') {
          (g.taskIds || []).forEach((id) => taskIdSet.add(String(id)));
        } else if (g.scope === 'day' && g.dayDate) {
          dayGrants.push({ owner: g.ownerEmail, dayDate: g.dayDate });
        } else if (g.scope === 'subtree' && g.subtreeRootEmail === g.ownerEmail) {
          // expert "my dashboard" window — owner's own tasks
          windowOwners.add(g.ownerEmail);
        }
      }
      if (taskIdSet.size === 0 && dayGrants.length === 0 && windowOwners.size === 0) return null;
      return { taskIdSet, dayGrants, windowOwners };
    } catch (error) {
      logger.warn('resolveDelegatedCoverage failed — continuing without coverage', {
        userEmail, error: error.message,
      });
      return null;
    }
  }

  _normName(value) {
    return (value || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
  }

  _isLeadTier(role) {
    return ['lead', 'mlead', 'am', 'mam'].includes((role || '').toLowerCase());
  }

  _isExpertTier(role) {
    return ['user', 'expert'].includes((role || '').toLowerCase());
  }

  async _coAssignContext(taskId, expertEmail) {
    let oid;
    try { oid = new ObjectId(taskId); }
    catch { const e = new Error('Invalid task ID'); e.statusCode = 400; throw e; }
    const col = this.taskModel.collection;
    if (!col) { const e = new Error('Database not ready'); e.statusCode = 503; throw e; }
    const task = await col.findOne(
      { _id: oid },
      { projection: { assignedTo: 1, assignedExpert: 1, coAssignees: 1, pendingCoAssigns: 1, subject: 1 } }
    );
    if (!task) { const e = new Error('Task not found'); e.statusCode = 404; throw e; }
    const email = (expertEmail || '').toString().toLowerCase().trim();
    if (!email || !email.includes('@')) { const e = new Error('expert email required'); e.statusCode = 400; throw e; }
    return { col, oid, task, email };
  }

  /**
   * Add (or request) a second expert on a task — the "co-expert".
   * Rules (2026-06-12 spec):
   *   admin → instant. Lead-tier whose report the expert is → instant.
   *   Lead-tier cross-squad (same department) → pending, approved by the
   *   expert's own lead. Expert-tier may request on their OWN tasks →
   *   pending the same way. Cross-department is refused.
   */
  async addCoAssignee(actor, taskId, expertEmail) {
    const { col, oid, task, email } = await this._coAssignContext(taskId, expertEmail);
    const actorEmail = (actor.email || '').toLowerCase();
    const actorRole = (actor.role || '').toLowerCase();

    const target = await Promise.resolve(this.userModel.getUserByEmail(email));
    if (!target) { const e = new Error(`user ${email} not found`); e.statusCode = 400; throw e; }
    if (target.active === false) { const e = new Error('that expert is inactive'); e.statusCode = 400; throw e; }
    const targetRole = (target.role || '').toLowerCase();
    if (!['user', 'expert'].includes(targetRole)) {
      const e = new Error('co-experts must be expert-tier users'); e.statusCode = 400; throw e;
    }

    const ownerEmail = (task.assignedTo || task.assignedExpert || '').toLowerCase();
    if (email === ownerEmail) { const e = new Error('that expert already owns this task'); e.statusCode = 400; throw e; }
    if ((task.coAssignees || []).map((x) => (x || '').toLowerCase()).includes(email)) {
      return { success: true, status: 'added', already: true };
    }

    // Same-department guard (owner's team vs target's team, when both known).
    if (ownerEmail) {
      const owner = await Promise.resolve(this.userModel.getUserByEmail(ownerEmail));
      if (owner && owner.team && target.team && owner.team !== target.team) {
        const e = new Error('co-experts must be in the same department'); e.statusCode = 400; throw e;
      }
    }

    let instant = actorRole === 'admin';
    if (!instant && this._isLeadTier(actorRole)) {
      const actorDisplay = this._normName(this.userService.deriveDisplayNameFromEmail(actorEmail));
      instant = Boolean(actorDisplay) && this._normName(target.teamLead) === actorDisplay;
    } else if (!instant && this._isExpertTier(actorRole)) {
      const mine = ownerEmail === actorEmail
        || (task.coAssignees || []).map((x) => (x || '').toLowerCase()).includes(actorEmail);
      if (!mine) { const e = new Error('you can only request co-experts on your own tasks'); e.statusCode = 403; throw e; }
    } else if (!instant && !this._isLeadTier(actorRole)) {
      const e = new Error('not allowed to add co-experts'); e.statusCode = 403; throw e;
    }

    const { notificationService } = await import('./notificationService.js');

    if (instant) {
      await col.updateOne(
        { _id: oid },
        {
          $addToSet: { coAssignees: email },
          $pull: { pendingCoAssigns: { email } },
          $push: { coAssignHistory: { action: 'added', email, by: actorEmail, at: new Date() } },
        }
      );
      Promise.all([
        notificationService.createNotification(email, {
          type: 'info',
          title: 'You were added to a task',
          description: `${actorEmail} added you as co-expert on: ${task.subject || taskId}`,
          link: '/tasks',
        }),
        ownerEmail ? notificationService.createNotification(ownerEmail, {
          type: 'info',
          title: 'Co-expert added to your task',
          description: `${this.userService.deriveDisplayNameFromEmail(email)} was added to: ${task.subject || taskId}`,
        }) : Promise.resolve(),
      ]).catch(() => {});
      logger.info('co-assignee added', { taskId, email, by: actorEmail });
      return { success: true, status: 'added' };
    }

    // pending — approver is the target expert's own team lead
    const { resolveTeamLeadEmail } = await import('./delegationService.js');
    const approverEmail = await resolveTeamLeadEmail(target);
    if (!approverEmail) {
      const e = new Error(`cannot resolve ${email}'s team lead for approval`); e.statusCode = 400; throw e;
    }
    if ((task.pendingCoAssigns || []).some((pc) => (pc.email || '').toLowerCase() === email)) {
      return { success: true, status: 'pending', already: true, approverEmail };
    }
    await col.updateOne(
      { _id: oid },
      { $push: { pendingCoAssigns: { email, requestedBy: actorEmail, requestedAt: new Date(), approverEmail } } }
    );
    notificationService.createNotification(approverEmail, {
      type: 'info',
      title: 'Co-expert approval needed',
      description: `${actorEmail} wants ${email} on: ${task.subject || taskId}. Review on the Delegations page.`,
      link: '/delegations',
    }).catch(() => {});
    logger.info('co-assignee requested', { taskId, email, by: actorEmail, approverEmail });
    return { success: true, status: 'pending', approverEmail };
  }

  /** Approve a pending co-assign — the expert's own lead (or admin). */
  async approveCoAssignee(actor, taskId, expertEmail) {
    const { col, oid, task, email } = await this._coAssignContext(taskId, expertEmail);
    const entry = (task.pendingCoAssigns || []).find((pc) => (pc.email || '').toLowerCase() === email);
    if (!entry) { const e = new Error('no pending co-assign for that expert'); e.statusCode = 404; throw e; }
    const actorEmail = (actor.email || '').toLowerCase();
    if ((actor.role || '').toLowerCase() !== 'admin' && actorEmail !== (entry.approverEmail || '').toLowerCase()) {
      const e = new Error('only the assigned approver or an admin can approve'); e.statusCode = 403; throw e;
    }
    await col.updateOne(
      { _id: oid },
      {
        $addToSet: { coAssignees: email },
        $pull: { pendingCoAssigns: { email } },
        $push: { coAssignHistory: { action: 'approved', email, by: actorEmail, at: new Date(), requestedBy: entry.requestedBy } },
      }
    );
    const { notificationService } = await import('./notificationService.js');
    Promise.all([
      notificationService.createNotification(email, {
        type: 'info',
        title: 'You were added to a task',
        description: `${actorEmail} approved you as co-expert on: ${task.subject || taskId}`,
        link: '/tasks',
      }),
      entry.requestedBy ? notificationService.createNotification(entry.requestedBy, {
        type: 'info',
        title: 'Co-expert approved',
        description: `${actorEmail} approved ${email} on: ${task.subject || taskId}`,
      }) : Promise.resolve(),
    ]).catch(() => {});
    logger.info('co-assignee approved', { taskId, email, by: actorEmail });
    return { success: true, status: 'added' };
  }

  /** Reject a pending co-assign — same authority as approve. */
  async rejectCoAssignee(actor, taskId, expertEmail, note = '') {
    const { col, oid, task, email } = await this._coAssignContext(taskId, expertEmail);
    const entry = (task.pendingCoAssigns || []).find((pc) => (pc.email || '').toLowerCase() === email);
    if (!entry) { const e = new Error('no pending co-assign for that expert'); e.statusCode = 404; throw e; }
    const actorEmail = (actor.email || '').toLowerCase();
    if ((actor.role || '').toLowerCase() !== 'admin' && actorEmail !== (entry.approverEmail || '').toLowerCase()) {
      const e = new Error('only the assigned approver or an admin can reject'); e.statusCode = 403; throw e;
    }
    await col.updateOne(
      { _id: oid },
      {
        $pull: { pendingCoAssigns: { email } },
        $push: { coAssignHistory: { action: 'rejected', email, by: actorEmail, at: new Date(), note: (note || '').slice(0, 300) } },
      }
    );
    if (entry.requestedBy) {
      const { notificationService } = await import('./notificationService.js');
      notificationService.createNotification(entry.requestedBy, {
        type: 'info',
        title: 'Co-expert request declined',
        description: `${actorEmail} declined ${email} on: ${task.subject || taskId}${note ? '. Note: ' + note : ''}`,
      }).catch(() => {});
    }
    logger.info('co-assignee rejected', { taskId, email, by: actorEmail });
    return { success: true, status: 'rejected' };
  }

  /** Remove a co-expert — admin, or a lead-tier actor for their own report. */
  async removeCoAssignee(actor, taskId, expertEmail) {
    const { col, oid, task, email } = await this._coAssignContext(taskId, expertEmail);
    const actorEmail = (actor.email || '').toLowerCase();
    const actorRole = (actor.role || '').toLowerCase();
    let allowed = actorRole === 'admin';
    if (!allowed && this._isLeadTier(actorRole)) {
      const target = await Promise.resolve(this.userModel.getUserByEmail(email));
      const actorDisplay = this._normName(this.userService.deriveDisplayNameFromEmail(actorEmail));
      allowed = Boolean(actorDisplay) && this._normName(target?.teamLead) === actorDisplay;
    }
    if (!allowed) { const e = new Error('only that expert\'s lead or an admin can remove them'); e.statusCode = 403; throw e; }
    await col.updateOne(
      { _id: oid },
      {
        $pull: { coAssignees: email, pendingCoAssigns: { email } },
        $push: { coAssignHistory: { action: 'removed', email, by: actorEmail, at: new Date() } },
      }
    );
    logger.info('co-assignee removed', { taskId, email, by: actorEmail });
    return { success: true, status: 'removed' };
  }
}

export const taskService = new TaskService();
