import moment from 'moment-timezone';
import { taskModel } from '../models/Task.js';
import { userModel } from '../models/User.js';
import { logger, createTimer } from '../utils/logger.js';

const TIMEZONE = 'America/New_York';
const RECEIVED_DATE_FIELD_ROLES = new Set(['admin', 'MM', 'MAM', 'mlead']);
const TOP_PERFORMER_LIMIT = 25;

export class TaskService {
  constructor() {
    this.taskModel = taskModel;
    this.userModel = userModel;
  }

  async getTasksForUser(userEmail, userRole, teamLead, manager, tab = "Date of Interview", targetDate) {
    const timer = createTimer('taskService.getTasksForUser', logger);
    try {
      logger.debug('Getting tasks for user', { userEmail, userRole, tab, targetDate });

      const teamEmails = this.userModel
        .getTeamEmails(userEmail, userRole, teamLead)
        .map((email) => email.toLowerCase());

      const tasks = await this.taskModel.getTasksForUser(
        userEmail,
        userRole,
        teamEmails,
        manager,
        tab,
        targetDate
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

  async getDashboardSummary(userEmail, userRole, teamLead, manager, options = {}) {
    const timer = createTimer('taskService.getDashboardSummary', logger);
    try {
      const {
        range = 'day',
        start,
        end,
        dateField
      } = options || {};

      const effectiveDateField = this.resolveDateField(userRole, dateField);
      const { startIso, endIso, rangeUsed } = this.resolveDateRange(range, start, end);

      logger.debug('Getting dashboard summary', {
        userEmail,
        userRole,
        dateField: effectiveDateField,
        range: rangeUsed,
        requested: { start, end, dateField, range }
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

      const task = await this.taskModel.collection.findOne(
        { _id: taskId },
        { projection: { replies: 0, body: 0 } }
      );

      if (!task) {
        throw new Error('Task not found');
      }

      const formattedTask = this.taskModel.formatTask(task);

      if (!formattedTask) {
        throw new Error('Invalid task data');
      }

      const hasAccess = this.checkTaskAccess(formattedTask, userEmail, userRole, teamLead);

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

  checkTaskAccess(task, userEmail, userRole, teamLead) {
    if (userRole === 'admin') {
      return true;
    }

    if (userRole === 'MAM' || userRole === 'MM' || userRole === 'mlead') {
      return true;
    }

    const userEmailLower = userEmail.toLowerCase();
    const assignedEmailLower = task.assignedEmail?.toLowerCase() || '';

    if (userEmailLower === assignedEmailLower) {
      return true;
    }

    const normalizedRole = (userRole || '').toLowerCase();

    if (normalizedRole === 'lead' || normalizedRole === 'am') {
      const teamEmails = this.userModel
        .getTeamEmails(userEmail, userRole, teamLead)
        .map((email) => email.toLowerCase());
      return teamEmails.includes(assignedEmailLower);
    }

    return false;
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
        limit = 50,
        offset = 0
      } = searchCriteria;

      const teamEmails = this.userModel.getTeamEmails(userEmail, userRole, teamLead);

      let query = this.buildSearchQuery(userEmail, userRole, manager, teamEmails);

      if (candidateName) {
        query['Candidate Name'] = { $regex: candidateName, $options: 'i' };
      }

      if (expert) {
        query.assignedTo = { $regex: expert, $options: 'i' };
      }

      if (status) {
        query.status = status;
      }

      if (dateFrom || dateTo) {
        query.receivedDateTime = {};
        if (dateFrom) query.receivedDateTime.$gte = dateFrom;
        if (dateTo) query.receivedDateTime.$lte = dateTo;
      }

      const tasks = await this.taskModel.collection
        .find(query, { projection: { replies: 0, body: 0 } })
        .skip(offset)
        .limit(limit)
        .toArray();

      const formattedTasks = tasks
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

    if (userRole === 'MAM' || userRole === 'MM') {
      const managerLocal = manager.toLowerCase().split(' ').join('.');
      const ccVal = userRole === 'MM' ? lowerEmail.split('@')[0] : managerLocal;

      return {
        $or: [
          { cc: { $regex: ccVal, $options: 'i' } },
          { sender: ccVal }
        ]
      };
    }

    if (userRole === 'mlead') {
      return {
        $or: [
          { cc: { $regex: lowerEmail, $options: 'i' } },
          { sender: lowerEmail }
        ]
      };
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
      }
    }

    if (userRole === 'admin') {
      kpi.branch = branchCounts;
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
    if (requestedField === 'receivedDateTime' && RECEIVED_DATE_FIELD_ROLES.has(userRole)) {
      return 'receivedDateTime';
    }

    if (requestedField && requestedField !== 'Date of Interview' && requestedField !== 'receivedDateTime') {
      logger.warn('Unsupported dateField requested, defaulting to Date of Interview', {
        requestedField,
        userRole
      });
    }

    if (requestedField === 'receivedDateTime' && !RECEIVED_DATE_FIELD_ROLES.has(userRole)) {
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

    return leaders.slice(0, TOP_PERFORMER_LIMIT);
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
