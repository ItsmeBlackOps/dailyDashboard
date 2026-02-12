import moment from 'moment-timezone';
import { ObjectId } from 'mongodb';
import { taskModel } from '../models/Task.js';
import { userModel } from '../models/User.js';
import { logger, createTimer } from '../utils/logger.js';

const TIMEZONE = 'America/New_York';
const RECEIVED_DATE_FIELD_ROLES = new Set(['admin', 'mm', 'mam', 'mlead', 'recruiter']);
// const TOP_PERFORMER_LIMIT = 25;

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class TaskService {
  constructor() {
    this.taskModel = taskModel;
    this.userModel = userModel;
  }

  async getTasksForUser(userEmail, userRole, teamLead, manager, tab = "Date of Interview", targetDate, options = {}) {
    const timer = createTimer('taskService.getTasksForUser', logger);
    try {
      logger.debug('Getting tasks for user', { userEmail, userRole, tab, targetDate, options });

      const teamEmails = this.userModel
        .getTeamEmails(userEmail, userRole, teamLead)
        .map((email) => email.toLowerCase());

      const tasks = await this.taskModel.getTasksForUser(
        userEmail,
        userRole,
        teamEmails,
        manager,
        tab,
        targetDate,
        options
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

      const teamEmails = this.userModel
        .getTeamEmails(userEmail, userRole, teamLead)
        .map((email) => email.toLowerCase());

      // 1. Initial Match (Criteria)
      const initialMatch = {};

      // Date Logic for Pipeline
      // effectiveDateField is usually 'Date of Interview' or 'receivedDateTime'
      if (rangeUsed === 'upcoming') {
        // Upcoming Logic (Date >= Today)
        const dateExpr = {
          $dateFromString: {
            dateString: "$Date of Interview",
            format: "%m/%d/%Y",
            timezone: "America/New_York",
            onError: null,
            onNull: null
          }
        };
        const todayDate = moment.tz(TIMEZONE).startOf('day').toDate();
        initialMatch.$expr = { $gt: [dateExpr, todayDate] };
      } else {
        // Range Logic
        if (effectiveDateField === 'receivedDateTime') {
          initialMatch.receivedDateTime = {};
          if (startIso) initialMatch.receivedDateTime.$gte = startIso;
          if (endIso) initialMatch.receivedDateTime.$lte = endIso;
        } else {
          // String Date Logic for "Date of Interview"
          // Standard string compare works IF formats are standard, but legacy MM/DD/YYYY is flawed for range.
          // Best effort: convert to date via $dateFromString
          const dateExpr = {
            $dateFromString: {
              dateString: "$Date of Interview",
              format: "%m/%d/%Y",
              timezone: "America/New_York",
              onError: null,
              onNull: null
            }
          };

          // Convert ISO strings back to Date objects for comparison
          const startDateObj = startIso ? new Date(startIso) : null;
          const endDateObj = endIso ? new Date(endIso) : null;

          const exprFilters = [];
          if (startDateObj) exprFilters.push({ $gte: [dateExpr, startDateObj] });
          if (endDateObj) exprFilters.push({ $lt: [dateExpr, endDateObj] });

          if (exprFilters.length > 0) {
            initialMatch.$expr = { $and: exprFilters };
          }
        }
      }

      // 2. Base Pipeline
      const pipeline = [
        { $match: initialMatch }
      ];

      // 3. Lookups (Access Control Dependencies) -- SAME AS SEARCH
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

      // 4. Access Control (Visibility Filter) -- SAME AS SEARCH
      // We should extract this logic ideally, but for now copying ensures strict equivalence.
      const normalizedRole = userRole.toLowerCase();
      let visibilityMatch = {};

      if (normalizedRole === 'admin') {
        // No filter
      } else if (['mam', 'mm', 'mlead'].includes(normalizedRole)) {
        visibilityMatch = this.buildSearchQuery(userEmail, userRole, manager, teamEmails);
      } else if (normalizedRole === 'recruiter') {
        visibilityMatch = this.buildSearchQuery(userEmail, userRole, manager, teamEmails);
      } else if (['lead', 'am'].includes(normalizedRole)) {
        // Optimization: Use $in for assignedTo to hit the Index
        const emailList = teamEmails.filter(Boolean);
        if (emailList.length > 0) {
          const regexObj = { $regex: emailList.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), $options: 'i' };
          visibilityMatch = {
            $or: [
              { assignedTo: { $in: emailList } }, // Primary Index Path
              { assignedTo: regexObj },
              { candidateExpertRaw: regexObj }
            ]
          };
        } else {
          const selfRegex = { $regex: userEmail, $options: 'i' };
          visibilityMatch = {
            $or: [
              { assignedTo: userEmail },
              { assignedTo: selfRegex },
              { candidateExpertRaw: selfRegex }
            ]
          };
        }
      } else {
        const selfRegex = { $regex: userEmail, $options: 'i' };
        visibilityMatch = {
          $or: [
            { assignedTo: userEmail },
            { assignedTo: selfRegex },
            { candidateExpertRaw: selfRegex },
            { suggestions: selfRegex }
          ]
        };
      }

      if (Object.keys(visibilityMatch).length > 0) {
        pipeline.push({ $match: visibilityMatch });
      }

      // 5. Pagination & Formatting
      pipeline.push({ $sort: { _id: -1 } });
      if (offset) pipeline.push({ $skip: offset });
      if (limit) pipeline.push({ $limit: limit });

      const collation = { locale: 'en', strength: 2 };

      const docs = await this.taskModel.collection.aggregate(pipeline, { collation }).toArray();

      let tasks = docs
        .map(task => this.taskModel.formatTask(task))
        .filter(Boolean);

      // Enrich with Appwrite transcript status
      tasks = await this.taskModel.enrichWithTranscriptStatus(tasks);

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
          teamSize: teamEmails.length,
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

      const summary = await this.taskModel.getDashboardSummary(
        userEmail,
        userRole,
        manager,
        teamEmails,
        startIso,
        endIso,
        effectiveDateField
      );

      const kpiTasks = await this.taskModel.getTasksForKpi(
        userEmail,
        userRole,
        manager,
        teamEmails,
        startIso,
        endIso,
        effectiveDateField
      );

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

  async getTaskById(taskId, userEmail, userRole, teamLead) {
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
        projection: { replies: 0, body: 0 }
      });

      if (!task) {
        throw new Error('Task not found');
      }

      const formattedTask = this.taskModel.formatTask(task);

      if (!formattedTask) {
        throw new Error('Invalid task data');
      }

      const hasAccess = this.checkTaskAccess(formattedTask, userEmail, userRole, teamLead);

      console.log('[checkTaskAccess]', {
        userEmail,
        userRole,
        teamLead,
        taskId,
        assignedTo: formattedTask.assignedTo || formattedTask.assignedEmail || formattedTask.assignedToEmail,
        hasAccess
      });

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

  checkTaskAccess(task, userEmail, userRole, teamLead) {
    return this.taskModel.shouldSendTaskToUser(
      { email: userEmail, role: userRole, teamLead },
      task,
      this.userModel
    );
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
      this.taskModel.setupChangeStream(io, this.userModel);
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

      const teamEmails = this.userModel.getTeamEmails(userEmail, userRole, teamLead);
      const normalizedRole = userRole.toLowerCase();

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
        // "Upcoming" means Today onwards in NYC time
        const todayStr = moment.tz(TIMEZONE).format('MM/DD/YYYY');
        // We can't easily do string comparison on "MM/DD/YYYY" if we want ">= Today".
        // However, the existing data relies on string dates.
        // But since format is MM/DD/YYYY, standard string compare WON'T work correctly (01/01/2026 < 12/31/2025 is false, but 02 < 01 is false).
        // Standard approach for this legacy string date format:
        // We either need to parse dates in aggregation (slow) or rely on a regex or application-side filtering if volume is low.
        // BUT, since we have limits, we can try to filter by converting field to date?
        // Let's use $expr with $dateFromString if we are on MongoDB 3.6+.

        // Helper to convert field
        const dateExpr = {
          $dateFromString: {
            dateString: "$Date of Interview",
            format: "%m/%d/%Y",
            timezone: "America/New_York",
            onError: null,
            onNull: null
          }
        };
        const todayDate = moment.tz(TIMEZONE).startOf('day').toDate();

        initialMatch.$expr = {
          $gte: [dateExpr, todayDate]
        };
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
      let visibilityMatch = {};

      if (normalizedRole === 'admin') {
        // No filter
      } else if (['mam', 'mm', 'mlead'].includes(normalizedRole)) {
        // Managers: Reuse buildUserQuery logic logic roughly
        // But since buildUserQuery returns a query object, we can use it directly if it only touches base fields.
        // Managers only look at cc/sender usually.
        visibilityMatch = this.buildSearchQuery(userEmail, userRole, manager, teamEmails);
      } else if (normalizedRole === 'recruiter') {
        // Recruiters: Reuse buildUserQuery logic
        visibilityMatch = this.buildSearchQuery(userEmail, userRole, manager, teamEmails);
      } else if (['lead', 'am'].includes(normalizedRole)) {
        // Leads: Team Assignment OR Team Suggestion
        // We need regex to match any team member in assignedTo OR candidateExpertRaw
        const teamRegex = teamEmails.map(e => {
          // Escape special chars just in case
          return e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }).join('|');

        // Names? Logic in filterAndFormatTokens is complex (token matching).
        // For search, we'll approximate with Email-based regex + basic Name regex if possible.
        // Getting exact "Token Match" in Aggregation is very hard.
        // We will stick to the RegExp of known team emails/names.
        // To improve, we should make sure teamEmails includes names (which getTeamEmails tries to do via display name derivation? No usually just emails).

      } else if (['lead', 'am'].includes(normalizedRole)) {
        // Optimization: Use $in for assignedTo to hit the Index
        const emailList = teamEmails.filter(Boolean);
        if (emailList.length > 0) {
          const regexObj = { $regex: emailList.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), $options: 'i' };
          visibilityMatch = {
            $or: [
              { assignedTo: { $in: emailList } }, // Primary Index Path
              { assignedTo: regexObj }, // Fallback for case mismatch if collation fails (safe)
              { candidateExpertRaw: regexObj }
            ]
          };
        } else {
          const selfRegex = { $regex: userEmail, $options: 'i' };
          visibilityMatch = {
            $or: [
              { assignedTo: userEmail }, // Primary Index Path
              { assignedTo: selfRegex },
              { candidateExpertRaw: selfRegex }
            ]
          };
        }
      } else {
        const selfRegex = { $regex: userEmail, $options: 'i' };
        visibilityMatch = {
          $or: [
            { assignedTo: userEmail }, // Primary Index Path
            { assignedTo: selfRegex },
            { candidateExpertRaw: selfRegex },
            { suggestions: selfRegex }
          ]
        };
      }

      if (Object.keys(visibilityMatch).length > 0) {
        pipeline.push({ $match: visibilityMatch });
      }

      // 5. Pagination & Formatting
      pipeline.push({ $sort: { _id: -1 } });
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

  buildSearchQuery(userEmail, userRole, manager, teamEmails) {
    const baseQuery = {};

    if (userRole === 'admin') {
      return baseQuery;
    }

    const lowerEmail = userEmail.toLowerCase();
    const normalizedRole = userRole.toLowerCase();

    if (['mlead', 'mam', 'mm'].includes(normalizedRole)) {
      const patterns = [
        { sender: { $regex: lowerEmail, $options: 'i' } },
        { cc: { $regex: lowerEmail, $options: 'i' } }
      ];

      if (teamEmails && teamEmails.length > 0) {
        const teamRegex = teamEmails
          .map(e => escapeRegex(e))
          .join('|');

        patterns.push({ sender: { $regex: teamRegex, $options: 'i' } });
        patterns.push({ cc: { $regex: teamRegex, $options: 'i' } });
        patterns.push({ assignedTo: { $regex: teamRegex, $options: 'i' } });
      }

      return { $or: patterns };
    }

    if (userRole === 'lead') {
      const teamLocals = teamEmails.map(e => e.split('@')[0]);
      const emailParts = lowerEmail.split('@')[0].split('.');
      const leadFullName = emailParts.length >= 2
        ? `${emailParts[0].charAt(0).toUpperCase()}${emailParts[0].slice(1)} ${emailParts[1].charAt(0).toUpperCase()}${emailParts[1].slice(1)}`
        : `${emailParts[0].charAt(0).toUpperCase()}${emailParts[0].slice(1)}`;

      return {
        $or: [
          { assignedTo: { $regex: teamEmails.join('|'), $options: 'i' } },
          { assignedTo: { $regex: teamLocals.join('|'), $options: 'i' } },
          { assignedTo: { $regex: leadFullName, $options: 'i' } }
        ]
      };
    }

    if (userRole === 'recruiter') {
      const localPart = lowerEmail.split('@')[0];
      const emailParts = localPart.split('.');
      const recruiterDisplay = emailParts.length >= 2
        ? `${emailParts[0].charAt(0).toUpperCase()}${emailParts[0].slice(1)} ${emailParts[1].charAt(0).toUpperCase()}${emailParts[1].slice(1)}`
        : `${localPart.charAt(0).toUpperCase()}${localPart.slice(1)}`;

      return {
        $or: [
          { sender: { $regex: localPart, $options: 'i' } },
          { sender: { $regex: lowerEmail, $options: 'i' } },
          { cc: { $regex: localPart, $options: 'i' } },
          { to: { $regex: localPart, $options: 'i' } },
          { assignedTo: { $regex: `^${localPart}$`, $options: 'i' } },
          { assignedTo: { $regex: `^${lowerEmail}$`, $options: 'i' } },
          { assignedTo: { $regex: `^${recruiterDisplay}$`, $options: 'i' } }
        ]
      };
    }

    // Regular user
    const emailParts = lowerEmail.split('@')[0].split('.');
    const firstLast = emailParts.length >= 2
      ? `${emailParts[0].charAt(0).toUpperCase()}${emailParts[0].slice(1)} ${emailParts[1].charAt(0).toUpperCase()}${emailParts[1].slice(1)}`
      : `${emailParts[0].charAt(0).toUpperCase()}${emailParts[0].slice(1)}`;

    return {
      $or: [
        { assignedTo: { $regex: `^${lowerEmail.split('@')[0]}$`, $options: 'i' } },
        { assignedTo: { $regex: `^${lowerEmail}$`, $options: 'i' } },
        { assignedTo: { $regex: `^${firstLast}$`, $options: 'i' } }
      ]
    };
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
}

export const taskService = new TaskService();
