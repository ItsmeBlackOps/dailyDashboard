import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { logSuggestionDebug } from '../utils/logflare.js';
import moment from 'moment-timezone';
import { Client, Databases, Query } from 'node-appwrite';
import { config } from '../config/index.js';
import { posthogLogger } from '../utils/posthogLogger.js';

function escapeRegex(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class TaskModel {
  constructor() {
    this.collection = null;
    this.appwriteDatabases = null;
  }

  async initialize() {
    this.collection = database.getCollection('taskBody');

    // Initialize Appwrite for transcript checks
    if (config.appwrite?.endpoint && config.appwrite?.projectId && config.appwrite?.apiKey) {
      this.appwriteClient = new Client()
        .setEndpoint(config.appwrite.endpoint)
        .setProject(config.appwrite.projectId)
        .setKey(config.appwrite.apiKey);
      this.appwriteDatabases = new Databases(this.appwriteClient);
    } else {
      logger.warn('Appwrite not configured. Transcript status checks will be skipped.');
      this.appwriteDatabases = null;
    }
  }

  formatTask(doc) {
    try {
      const dateStr = doc["Date of Interview"];
      const startStr = doc["Start Time Of Interview"];
      const endStr = doc["End Time Of Interview"];

      const startMoment = moment.tz(
        `${dateStr} ${startStr}`,
        ["MM/DD/YYYY h:mm A", "MM/DD/YYYY hh:mm A"],
        "America/New_York"
      );

      const endMoment = moment.tz(
        `${dateStr} ${endStr}`,
        "MM/DD/YYYY HH:mm a",
        "America/New_York"
      );

      if (!startMoment.isValid() || !endMoment.isValid()) {
        logger.debug('Invalid interview times', { taskId: doc._id });
        return null;
      }

      let assignedExpert = "Not Assigned";
      let assignedEmail = null;
      let assignedAt = doc.assignedAt ? new Date(doc.assignedAt).toISOString() : null;

      const assignedField = doc.assignedTo || doc.AssignedExpert || doc.assignedExpert;
      if (assignedField) {
        const normalized = String(assignedField).trim();
        assignedExpert = normalized;

        if (normalized.includes("@")) {
          assignedEmail = normalized.toLowerCase();
          const parts = assignedEmail.split("@")[0].split(".");
          assignedExpert = parts
            .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
            .join(" ");
        }
      }

      // Build candidate expert display (for suggestions)
      let candidateExpertDisplay = null;
      const expertRaw = doc.candidateExpertRaw || null;
      if (expertRaw && typeof expertRaw === 'string' && expertRaw.trim()) {
        const normalized = expertRaw.trim();
        if (normalized.includes('@')) {
          const localPart = normalized.toLowerCase().split('@')[0];
          const parts = localPart.split(/[._\s-]+/).filter(Boolean);
          candidateExpertDisplay = parts
            .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
            .join(' ');
        } else {
          candidateExpertDisplay = normalized;
        }
      }

      const suggestions = Array.isArray(doc.suggestions)
        ? doc.suggestions
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter(Boolean)
        : [];

      if (candidateExpertDisplay) {
        const lowerDisplay = candidateExpertDisplay.toLowerCase();
        const hasCandidate = suggestions.some(
          (entry) => entry && entry.toLowerCase() === lowerDisplay
        );
        if (!hasCandidate) {
          suggestions.push(candidateExpertDisplay);
        }
      }

      const recruiterName = this.deriveDisplayNameFromEmail(doc.sender || '');

      return {
        ...doc,
        assignedExpert,
        assignedEmail,
        assignedAt,
        startTime: startMoment,
        endTime: endMoment,
        candidateExpertDisplay,
        suggestions,
        recruiterName: recruiterName || null
      };
    } catch (error) {
      logger.error('Error formatting task', { error: error.message, taskId: doc._id });
      return null;
    }
  }

  async getTasksForUser(userEmail, userRole, teamEmails, manager, tab = "Date of Interview", targetDate, options = {}) {
    try {
      const { limit, offset } = options;
      const targetMoment = targetDate
        ? moment(targetDate).tz('America/New_York')
        : moment.tz('America/New_York');

      if (!targetMoment.isValid()) {
        throw new Error('Invalid target date provided');
      }

      let effectiveTeamEmails = Array.isArray(teamEmails) ? [...teamEmails] : [];
      const normalizedRole = (userRole || '').toLowerCase();

      if ((normalizedRole === 'lead' || normalizedRole === 'am') && effectiveTeamEmails.length === 0) {
        try {
          const usersCol = database.getCollection('users');
          const selfDisplayName = this.deriveDisplayNameFromEmail(userEmail);
          const team = await usersCol
            .find(
              { teamLead: { $regex: `^${escapeRegex(selfDisplayName)}$`, $options: 'i' } },
              { projection: { email: 1 } }
            )
            .toArray();

          const pulled = team
            .map((u) => (u?.email || '').toLowerCase())
            .filter(Boolean);
          const set = new Set([
            ...effectiveTeamEmails.map((email) => (email || '').toLowerCase()),
            ...pulled
          ]);
          effectiveTeamEmails = Array.from(set);
        } catch (e) {
          logger.error('Failed to expand teamEmails from users collection', { error: e.message, userEmail });
        }
      }

      const startOfDay = targetMoment.clone().startOf('day');
      const endOfDay = targetMoment.clone().endOf('day');

      const roleFilter = this.buildUserQuery(userEmail, userRole, manager);
      const dateField = tab === 'receivedDateTime' ? 'receivedDateTime' : 'Date of Interview';

      let dateFilter;
      if (dateField === 'receivedDateTime') {
        dateFilter = {
          receivedDateTime: {
            $gte: startOfDay.toISOString(),
            $lt: endOfDay.toISOString()
          }
        };
      } else {
        dateFilter = {
          'Date of Interview': targetMoment.format('MM/DD/YYYY')
        };
      }

      const query = Object.keys(roleFilter || {}).length
        ? { $and: [roleFilter, dateFilter] }
        : dateFilter;

      logger.debug('Executing task query', { userEmail, query, limit, offset });

      const pipeline = [{ $match: query }];

      // Ensure specific sort order so pagination is stable
      // We rely on _id for stability if dates are strings or duplicates exist
      pipeline.push({ $sort: { _id: -1 } });

      if (offset !== undefined && offset > 0) {
        pipeline.push({ $skip: offset });
      }
      if (limit !== undefined && limit > 0) {
        pipeline.push({ $limit: limit });
      }

      const docs = await this.collection
        .aggregate([
          ...pipeline,
          { $match: {} }, // just to continue chain cleanly if pipeline was empty (it's not)
          // Join candidate details to extract Expert for suggestions
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
        ])
        .toArray();

      let tasks = this.filterAndFormatTasks(docs, userEmail, userRole, effectiveTeamEmails);

      // Enrich with Appwrite transcript status
      tasks = await this.enrichWithTranscriptStatus(tasks);

      tasks.sort((a, b) => {
        const diff = a.startTime - b.startTime;
        if (diff !== 0) return diff;
        return a.endTime - b.endTime;
      });

      logger.info('Tasks retrieved', {
        userEmail,
        count: tasks.length,
        totalDocs: docs.length
      });

      return tasks;
    } catch (error) {
      logger.error('Failed to get tasks for user', {
        error: error.message,
        userEmail,
        userRole
      });
      throw error;
    }
  }

  buildUserQuery(userEmail, userRole, manager) {
    const lowerEmail = userEmail.toLowerCase();

    if (userRole === "MAM" || userRole === "MM") {
      const mngr = manager.toLowerCase().split(" ").join(".");
      const ccVal = userRole === "MM" ? lowerEmail.split("@")[0] : mngr;
      const selfLocal = lowerEmail.split("@")[0];
      const selfName = this.deriveDisplayNameFromEmail(lowerEmail);
      const selfPatterns = [
        { assignedTo: { $regex: `^${escapeRegex(selfLocal)}$`, $options: "i" } },
        { assignedTo: { $regex: `^${escapeRegex(lowerEmail)}$`, $options: "i" } }
      ];
      if (selfName) {
        selfPatterns.push({ assignedTo: { $regex: `^${escapeRegex(selfName)}$`, $options: "i" } });
      }

      return {
        $or: [
          { cc: { $regex: ccVal, $options: "i" } },
          { sender: { $regex: ccVal, $options: "i" } },
          ...selfPatterns
        ]
      };
    } else if (userRole === "mlead") {
      return {
        $or: [
          { cc: { $regex: lowerEmail, $options: "i" } },
          { sender: { $regex: lowerEmail, $options: "i" } },
        ],
      };
    } else if (userRole === "recruiter") {
      const local = lowerEmail.split('@')[0];
      const parts = local.split('.');
      const recruiterDisplay = parts.length >= 2
        ? `${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)} ${parts[1].charAt(0).toUpperCase()}${parts[1].slice(1)}`
        : `${local.charAt(0).toUpperCase()}${local.slice(1)}`;

      return {
        $or: [
          { sender: { $regex: local, $options: 'i' } },
          { sender: { $regex: lowerEmail, $options: 'i' } },
          { cc: { $regex: local, $options: 'i' } },
          { to: { $regex: local, $options: 'i' } },
          { assignedTo: { $regex: `^${local}$`, $options: 'i' } },
          { assignedTo: { $regex: `^${lowerEmail}$`, $options: 'i' } },
          { assignedTo: { $regex: `^${recruiterDisplay}$`, $options: 'i' } }
        ]
      };
    } else {
      return {};
    }
  }

  async enrichWithTranscriptStatus(tasks) {
    if (!this.appwriteDatabases) {
      if (config.appwrite?.endpoint) { // Only log if we tried to configure it
        logger.warn('Appwrite database client not initialized, skipping transcript check');
      }
      return tasks.map(task => ({ ...task, transcription: false }));
    }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return tasks.map(task => ({ ...task, transcription: false }));
    }

    const { databaseId, transcriptsCollectionId } = config.appwrite;

    // Extract unique subjects
    const subjects = [...new Set(tasks
      .map(t => (t.subject || t.Subject || '').trim())
      .filter(Boolean))]; // Dedupe and filter empty

    if (subjects.length === 0) {
      return tasks.map(task => ({ ...task, transcription: false }));
    }

    logger.debug('Checking transcript availability in Appwrite', {
      taskCount: tasks.length,
      subjectCount: subjects.length
    });

    const transcriptTitles = new Set();
    const BATCH_SIZE = 50;

    try {
      // Process in batches
      for (let i = 0; i < subjects.length; i += BATCH_SIZE) {
        const batch = subjects.slice(i, i + BATCH_SIZE);

        posthogLogger.emit({
          severityText: 'INFO',
          body: 'Appwrite Transcript Query Batch',
          attributes: {
            event: 'transcript_query_batch',
            batchIndex: i / BATCH_SIZE,
            batchSize: batch.length,
            totalSubjects: subjects.length,
            queryValues: batch
          }
        });

        const queries = [Query.equal('title', batch)];
        const response = await this.appwriteDatabases.listDocuments(
          databaseId,
          transcriptsCollectionId,
          queries
        );

        response.documents.forEach(doc => transcriptTitles.add(doc.title));
      }

      // Identify matched and unmatched
      const matchedSubjects = subjects.filter(s => transcriptTitles.has(s));
      const unmatchedSubjects = subjects.filter(s => !transcriptTitles.has(s));

      logger.debug('Transcript check complete', {
        foundCount: transcriptTitles.size,
        total: subjects.length
      });

      // Log to PostHog: Final Query results
      posthogLogger.emit({
        severityText: 'INFO',
        body: 'Appwrite Transcript Query Results',
        attributes: {
          event: 'transcript_query_result',
          totalSubjects: subjects.length,
          foundCount: transcriptTitles.size,
          matchedSubjects,
          unmatchedSubjects,
          matchRate: `${subjects.length > 0 ? ((transcriptTitles.size / subjects.length) * 100).toFixed(1) : '0'}%`,
          transcriptTitles: Array.from(transcriptTitles)
        }
      });

      // Enrich tasks with transcription status
      return tasks.map(task => {
        const subject = (task.subject || task.Subject || '').trim();
        return {
          ...task,
          transcription: transcriptTitles.has(subject)
        };
      });
    } catch (error) {
      logger.error('Failed to check transcript status from Appwrite', {
        error: error.message,
        stack: error.stack
      });
      // On error, return tasks with transcription=false
      return tasks.map(task => ({ ...task, transcription: false }));
    }
  }

  filterAndFormatTasks(docs, userEmail, userRole, teamEmails = []) {
    const toId = (value) => {
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'object' && 'toHexString' in value) {
        try {
          return value.toHexString();
        } catch {
          return String(value);
        }
      }
      return String(value);
    };

    const normalizeForComparison = (value = '') => {
      if (!value) return '';
      return value
        .toString()
        .trim()
        .toLowerCase()
        .split('@')[0]
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const addTokens = (set, ...values) => {
      for (const candidate of values) {
        const normalized = normalizeForComparison(candidate);
        if (!normalized) continue;
        set.add(normalized);

        const segments = normalized.split(' ').filter(Boolean);
        if (segments.length > 1) {
          for (const segment of segments) {
            set.add(segment);
          }
        }
      }
    };

    const toArray = (value) => (Array.isArray(value) ? value : []);

    const extractNameTokens = (value) => {
      const normalized = normalizeForComparison(value);
      if (!normalized) return [];
      return normalized.split(' ').filter(Boolean);
    };

    const hasAllTokens = (sourceSet, value) => {
      if (!value) return false;
      const tokens = extractNameTokens(value);
      if (tokens.length === 0) return false;
      return tokens.every((token) => sourceSet.has(token));
    };

    const matchAnyName = (sourceSet, ...values) => {
      for (const value of values) {
        if (!value) continue;
        if (hasAllTokens(sourceSet, value)) {
          return true;
        }
      }
      return false;
    };

    const matchSuggestions = (sourceSet, suggestionsList) => {
      for (const suggestion of toArray(suggestionsList)) {
        if (hasAllTokens(sourceSet, suggestion)) {
          return true;
        }
      }
      return false;
    };

    const tasks = [];
    const userEmailLower = (userEmail || '').toLowerCase();
    const userLocal = userEmailLower.split('@')[0];
    const normalizedRole = (userRole || '').toLowerCase();

    const teamEmailSet = new Set();
    const teamTokenSet = new Set();
    for (const email of teamEmails || []) {
      const lower = (email || '').toLowerCase();
      if (!lower) continue;
      teamEmailSet.add(lower);
      const local = lower.split('@')[0];
      addTokens(teamTokenSet, local, this.deriveDisplayNameFromEmail(lower));
    }

    const userTokenSet = new Set();
    addTokens(userTokenSet, userEmailLower, userLocal, this.deriveDisplayNameFromEmail(userEmailLower));

    for (const doc of docs) {
      const task = this.formatTask(doc);
      if (!task) continue;

      const assignedEmailLower = task.assignedEmail?.toLowerCase() || '';
      const statusLower = (task.status || '').toLowerCase();

      const suggestionTokens = new Set();
      for (const suggestion of toArray(task.suggestions)) {
        addTokens(suggestionTokens, suggestion);
      }
      addTokens(
        suggestionTokens,
        doc.candidateExpertRaw,
        task.candidateExpertDisplay,
        task.assignedExpert
      );

      const baseMeta = {
        taskId: toId(task._id || doc._id),
        userEmail: userEmailLower,
        userRole: normalizedRole,
        status: statusLower,
        assignedEmail: assignedEmailLower || null,
        candidateExpertRaw: doc.candidateExpertRaw || null,
        candidateExpertDisplay: task.candidateExpertDisplay || null,
        suggestions: toArray(task.suggestions),
        suggestionTokens: Array.from(suggestionTokens),
        teamEmails: Array.from(teamEmailSet),
        teamTokens: Array.from(teamTokenSet),
        userTokens: Array.from(userTokenSet)
      };

      if (['mam', 'mm', 'mlead'].includes(normalizedRole)) {
        const recruiterName = task.recruiterName || this.deriveDisplayNameFromEmail(doc.sender || '');

        logSuggestionDebug('TasksToday manager visibility applied', {
          ...baseMeta,
          reason: 'manager_access',
          recruiterName: recruiterName || null
        });

        tasks.push({ ...task, recruiterName: recruiterName || null });
        continue;
      }

      if (normalizedRole === 'recruiter') {
        const senderLower = (doc.sender || '').toLowerCase();
        if (senderLower === userEmailLower) {
          logSuggestionDebug('TasksToday recruiter visibility via sender match', {
            ...baseMeta,
            reason: 'recruiter_sender_match'
          });
          tasks.push(task);
          continue;
        }
        if (assignedEmailLower === userEmailLower) {
          logSuggestionDebug('TasksToday recruiter visibility via assignment match', {
            ...baseMeta,
            reason: 'recruiter_assignment_match'
          });
          tasks.push(task);
        } else {
          logSuggestionDebug('TasksToday recruiter visibility skipped', {
            ...baseMeta,
            reason: 'recruiter_no_match',
            sender: senderLower
          });
        }
        continue;
      }

      const isAdmin = normalizedRole === 'admin';
      const isSelf = userEmailLower === assignedEmailLower;
      const isOnTeam = teamEmailSet.has(assignedEmailLower) || teamEmailSet.has(candidateExpertRaw);

      if (isAdmin || isSelf || isOnTeam) {
        logSuggestionDebug('TasksToday base visibility satisfied', {
          ...baseMeta,
          reason: isAdmin ? 'admin_access' : isSelf ? 'self_assignment' : 'team_assignment'
        });
        tasks.push(task);
        continue;
      }

      if ((normalizedRole === 'lead' || normalizedRole === 'am')) {
        const candidateRawLower = (doc.candidateExpertRaw || '').toLowerCase();
        const candidateMatchesTeamEmail = candidateRawLower && teamEmailSet.has(candidateRawLower);
        let candidateMatchesTeamTokens = false;
        let teamTokenMatchSource = null;

        if (!candidateMatchesTeamEmail) {
          if (matchAnyName(teamTokenSet, doc.candidateExpertRaw)) {
            candidateMatchesTeamTokens = true;
            teamTokenMatchSource = 'candidate_raw';
          } else if (matchAnyName(teamTokenSet, task.candidateExpertDisplay)) {
            candidateMatchesTeamTokens = true;
            teamTokenMatchSource = 'candidate_display';
          } else if (matchAnyName(teamTokenSet, task.assignedExpert)) {
            candidateMatchesTeamTokens = true;
            teamTokenMatchSource = 'assigned_expert';
          } else if (matchSuggestions(teamTokenSet, task.suggestions)) {
            candidateMatchesTeamTokens = true;
            teamTokenMatchSource = 'suggestion';
          }
        }

        if (candidateMatchesTeamEmail || candidateMatchesTeamTokens) {
          logSuggestionDebug('TasksToday team suggestion matched', {
            ...baseMeta,
            reason: candidateMatchesTeamEmail ? 'team_email_match' : 'team_token_match',
            tokenMatchSource: candidateMatchesTeamEmail ? 'email' : teamTokenMatchSource
          });
          tasks.push(task);
          continue;
        }

        logSuggestionDebug('TasksToday team suggestion did not match', {
          ...baseMeta,
          reason: 'team_no_match'
        });
      }

      if (normalizedRole === 'user' || normalizedRole === 'expert') {
        const candidateRawLower = (doc.candidateExpertRaw || '').toLowerCase();
        const candidateMatchesEmail =
          candidateRawLower && (candidateRawLower === userEmailLower || candidateRawLower === userLocal);

        let candidateMatchesTokens = false;
        let userTokenMatchSource = null;
        if (!candidateMatchesEmail) {
          if (matchAnyName(userTokenSet, doc.candidateExpertRaw)) {
            candidateMatchesTokens = true;
            userTokenMatchSource = 'candidate_raw';
          } else if (matchAnyName(userTokenSet, task.candidateExpertDisplay)) {
            candidateMatchesTokens = true;
            userTokenMatchSource = 'candidate_display';
          } else if (matchAnyName(userTokenSet, task.assignedExpert)) {
            candidateMatchesTokens = true;
            userTokenMatchSource = 'assigned_expert';
          } else if (matchSuggestions(userTokenSet, task.suggestions)) {
            candidateMatchesTokens = true;
            userTokenMatchSource = 'suggestion';
          }
        }

        if (candidateMatchesEmail || candidateMatchesTokens) {
          logSuggestionDebug('TasksToday suggestion matched user', {
            ...baseMeta,
            reason: candidateMatchesEmail ? 'email_match' : 'token_match',
            tokenMatchSource: candidateMatchesEmail ? 'email' : userTokenMatchSource
          });
          tasks.push(task);
          continue;
        }
      }
    }

    return tasks;
  }

  async getDashboardSummary(userEmail, userRole, manager, teamEmails, startDate, endDate, dateField = 'Date of Interview') {
    try {
      const roleMatch = this.buildDashboardRoleMatch(userEmail, userRole, manager, teamEmails);
      const dateMatch = this.buildDateMatch(dateField, startDate, endDate);
      const baseMatch = {
        ...roleMatch,
        ...dateMatch
      };

      const pipeline = [
        { $match: baseMatch },
        {
          $addFields: {
            normalizedRound: {
              $let: {
                vars: {
                  trimmed: {
                    $trim: {
                      input: { $ifNull: ["$actualRound", ""] }
                    }
                  }
                },
                in: {
                  $cond: [
                    { $eq: ["$$trimmed", ""] },
                    "Unknown",
                    "$$trimmed"
                  ]
                }
              }
            }
          }
        },
        {
          $group: {
            _id: "$Candidate Name",
            rounds: { $push: "$normalizedRound" },
            lastDocument: { $last: "$$ROOT" }
          }
        },
        {
          $project: {
            _id: 0,
            "Candidate Name": "$_id",
            actualRoundCount: {
              $arrayToObject: {
                $map: {
                  input: { $setUnion: ["$rounds"] },
                  as: "round",
                  in: {
                    k: "$$round",
                    v: {
                      $size: {
                        $filter: {
                          input: "$rounds",
                          cond: { $eq: ["$$this", "$$round"] }
                        }
                      }
                    }
                  }
                }
              }
            },
            "Last Sender": "$lastDocument.sender",
            "Last CC": "$lastDocument.cc",
            Expert: "$lastDocument.assignedTo"
          }
        }
      ];

      logger.debug('Executing dashboard aggregation', { userEmail, baseMatch, dateField });

      const summary = await this.collection.aggregate(pipeline).toArray();

      logger.info('Dashboard summary retrieved', {
        userEmail,
        count: summary.length,
        dateField,
        dateRange: { start: startDate, end: endDate }
      });

      return summary;
    } catch (error) {
      logger.error('Failed to get dashboard summary', {
        error: error.message,
        userEmail,
        userRole
      });
      throw error;
    }
  }

  async getTasksForKpi(userEmail, userRole, manager, teamEmails, startDate, endDate, dateField = 'Date of Interview') {
    try {
      const roleMatch = this.buildDashboardRoleMatch(userEmail, userRole, manager, teamEmails);
      const dateMatch = this.buildDateMatch(dateField, startDate, endDate);
      const match = {
        ...roleMatch,
        ...dateMatch
      };

      const docs = await this.collection.find(match, {
        projection: {
          receivedDateTime: 1,
          status: 1,
          assignedTo: 1,
          assignedExpert: 1,
          assignedToEmail: 1,
          sender: 1,
          cc: 1,
          to: 1,
          'Date of Interview': 1,
          actualRound: 1,
          'Candidate Name': 1
        }
      }).toArray();

      logger.debug('KPI task dataset prepared', {
        userEmail,
        count: docs.length
      });

      return docs;
    } catch (error) {
      logger.error('Failed to load tasks for KPI computation', {
        error: error.message,
        userEmail,
        userRole
      });
      return [];
    }
  }

  async getTasksByRange(userEmail, userRole, manager, teamEmails, startDate, endDate, dateField = 'Date of Interview', options = {}) {
    try {
      const { limit, offset } = options;
      let effectiveTeamEmails = Array.isArray(teamEmails) ? [...teamEmails] : [];
      const normalizedRole = (userRole || '').toLowerCase();

      if ((normalizedRole === 'lead' || normalizedRole === 'am') && effectiveTeamEmails.length === 0) {
        try {
          const usersCol = database.getCollection('users');
          const selfDisplayName = this.deriveDisplayNameFromEmail(userEmail);
          const team = await usersCol
            .find(
              { teamLead: { $regex: `^${escapeRegex(selfDisplayName)}$`, $options: 'i' } },
              { projection: { email: 1 } }
            )
            .toArray();

          const pulled = team
            .map((u) => (u?.email || '').toLowerCase())
            .filter(Boolean);
          const set = new Set([
            ...effectiveTeamEmails.map((email) => (email || '').toLowerCase()),
            ...pulled
          ]);
          effectiveTeamEmails = Array.from(set);
        } catch (e) {
          logger.error('Failed to expand teamEmails from users collection', { error: e.message, userEmail });
        }
      }

      const shouldSkipRoleMatch = normalizedRole === 'lead' || normalizedRole === 'am';
      const roleMatch = shouldSkipRoleMatch
        ? {}
        : this.buildDashboardRoleMatch(userEmail, userRole, manager, effectiveTeamEmails);
      const dateMatch = this.buildDateMatch(dateField, startDate, endDate);
      const baseMatch = {
        ...roleMatch,
        ...dateMatch
      };

      const pipeline = [{ $match: baseMatch }];

      // Stable sort for pagination
      pipeline.push({ $sort: { _id: -1 } });

      if (offset !== undefined && offset > 0) {
        pipeline.push({ $skip: offset });
      }
      if (limit !== undefined && limit > 0) {
        pipeline.push({ $limit: limit });
      }

      const docs = await this.collection
        .aggregate([
          ...pipeline,
          { $match: {} }, // Pass-through checks
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
        ])
        .toArray();

      let tasks = this.filterAndFormatTasks(docs, userEmail, userRole, effectiveTeamEmails);

      // Enrich with Appwrite transcript status
      tasks = await this.enrichWithTranscriptStatus(tasks);

      tasks.sort((a, b) => {
        const aS = (a.startTime ? new Date(a.startTime) : new Date(0)).getTime();
        const bS = (b.startTime ? new Date(b.startTime) : new Date(0)).getTime();
        if (aS !== bS) return aS - bS;
        const aE = (a.endTime ? new Date(a.endTime) : new Date(0)).getTime();
        const bE = (b.endTime ? new Date(b.endTime) : new Date(0)).getTime();
        return aE - bE;
      });

      return tasks;
    } catch (error) {
      logger.error('Failed to get tasks by range', {
        error: error.message,
        userEmail,
        userRole
      });
      throw error;
    }
  }

  async saveMeetingLinks(taskId, links = {}) {
    try {
      if (!taskId) {
        throw new Error('Task id is required');
      }

      let objectId;
      try {
        objectId = new ObjectId(taskId);
      } catch (error) {
        throw new Error('Invalid task id');
      }

      const update = {};
      if (typeof links.joinUrl === 'string' && links.joinUrl.trim()) {
        update.joinUrl = links.joinUrl.trim();
      }
      if (typeof links.joinWebUrl === 'string' && links.joinWebUrl.trim()) {
        update.joinWebUrl = links.joinWebUrl.trim();
      }
      update.meetingUpdatedAt = new Date().toISOString();

      if (Object.keys(update).length === 1) {
        throw new Error('No meeting links provided');
      }

      const result = await this.collection.updateOne({ _id: objectId }, { $set: update });
      if (!result.matchedCount) {
        throw new Error('Task not found');
      }
      return result;
    } catch (error) {
      logger.error('Failed to save meeting links', { taskId, error: error.message });
      throw error;
    }
  }

  buildDateMatch(dateField, startDate, endDate) {
    if (!startDate && !endDate) {
      return {};
    }

    if (dateField === 'receivedDateTime') {
      const range = {};
      if (startDate) {
        range.$gte = startDate;
      }
      if (endDate) {
        range.$lt = endDate;
      }
      return Object.keys(range).length > 0 ? { receivedDateTime: range } : {};
    }

    const comparisons = [];
    const dateExpression = {
      $dateFromString: {
        dateString: '$Date of Interview',
        format: '%m/%d/%Y',
        timezone: 'America/New_York',
        onError: null,
        onNull: null
      }
    };

    if (startDate) {
      comparisons.push({ $gte: [dateExpression, new Date(startDate)] });
    }
    if (endDate) {
      comparisons.push({ $lt: [dateExpression, new Date(endDate)] });
    }

    if (comparisons.length === 0) {
      return {};
    }

    if (comparisons.length === 1) {
      return { $expr: comparisons[0] };
    }

    return { $expr: { $and: comparisons } };
  }

  buildDashboardRoleMatch(userEmail, userRole, manager, teamEmails) {
    const lowerEmail = (userEmail || '').toLowerCase();
    const emailLocal = lowerEmail.split('@')[0];
    const normalizedRole = (userRole || '').toLowerCase();
    const normalizedTeamEmails = (teamEmails || []).map((email) => email.toLowerCase());
    const teamLocals = normalizedTeamEmails.map((email) => email.split('@')[0]).filter(Boolean);
    const teamNames = normalizedTeamEmails
      .map((email) => this.deriveDisplayNameFromEmail(email))
      .filter(Boolean);

    if (normalizedRole === 'admin') {
      return {};
    }

    if (normalizedRole === 'mm' || normalizedRole === 'mam') {
      const managerLocal = (manager || '').toLowerCase().split(' ').join('.');
      const ccVal = normalizedRole === 'mm' ? emailLocal : managerLocal;
      const selfName = this.deriveDisplayNameFromEmail(lowerEmail);
      const selfPatterns = [
        { assignedTo: { $regex: `^${escapeRegex(emailLocal)}$`, $options: 'i' } },
        { assignedTo: { $regex: `^${escapeRegex(lowerEmail)}$`, $options: 'i' } }
      ];
      if (selfName) {
        selfPatterns.push({ assignedTo: { $regex: `^${escapeRegex(selfName)}$`, $options: 'i' } });
      }

      return {
        $or: [
          { cc: { $regex: escapeRegex(ccVal), $options: 'i' } },
          { sender: { $regex: escapeRegex(ccVal), $options: 'i' } },
          ...selfPatterns
        ],
      };
    }

    if (normalizedRole === 'mlead') {
      return {
        $or: [
          { cc: { $regex: escapeRegex(lowerEmail), $options: 'i' } },
          { sender: { $regex: escapeRegex(emailLocal), $options: 'i' } },
          { sender: { $regex: escapeRegex(lowerEmail), $options: 'i' } },
        ],
      };
    }

    if (['lead', 'am'].includes(normalizedRole)) {
      const patterns = [];

      if (normalizedTeamEmails.length > 0) {
        const emailPattern = normalizedTeamEmails.map(escapeRegex).join('|');
        patterns.push({ assignedTo: { $regex: emailPattern, $options: 'i' } });
      }

      if (teamLocals.length > 0) {
        const localPattern = teamLocals.map(escapeRegex).join('|');
        patterns.push({ assignedTo: { $regex: localPattern, $options: 'i' } });
      }

      if (teamNames.length > 0) {
        const namePattern = teamNames.map(escapeRegex).join('|');
        patterns.push({ assignedTo: { $regex: namePattern, $options: 'i' } });
      }

      const selfName = this.deriveDisplayNameFromEmail(lowerEmail);
      const selfPatterns = [
        { assignedTo: { $regex: escapeRegex(lowerEmail), $options: 'i' } },
        { assignedTo: { $regex: escapeRegex(emailLocal), $options: 'i' } },
      ];
      if (selfName) {
        selfPatterns.push({ assignedTo: { $regex: escapeRegex(selfName), $options: 'i' } });
      }
      patterns.push(...selfPatterns);

      if (patterns.length === 0) {
        return {};
      }

      return { $or: patterns };
    }

    if (normalizedRole === 'recruiter') {
      const selfName = this.deriveDisplayNameFromEmail(lowerEmail);
      const basePatterns = [
        { sender: { $regex: escapeRegex(emailLocal), $options: 'i' } },
        { sender: { $regex: escapeRegex(lowerEmail), $options: 'i' } },
        { cc: { $regex: escapeRegex(emailLocal), $options: 'i' } },
        { cc: { $regex: escapeRegex(lowerEmail), $options: 'i' } },
        { to: { $regex: escapeRegex(emailLocal), $options: 'i' } },
        { to: { $regex: escapeRegex(lowerEmail), $options: 'i' } }
      ];
      if (selfName) {
        const escapedName = escapeRegex(selfName);
        basePatterns.push({ assignedTo: { $regex: `^${escapedName}$`, $options: 'i' } });
        basePatterns.push({ sender: { $regex: escapedName, $options: 'i' } });
        basePatterns.push({ cc: { $regex: escapedName, $options: 'i' } });
        basePatterns.push({ to: { $regex: escapedName, $options: 'i' } });
      }
      return { $or: basePatterns };
    }

    if (['user'].includes(normalizedRole)) {
      const selfName = this.deriveDisplayNameFromEmail(lowerEmail);
      const patterns = [
        { assignedTo: { $regex: `^${escapeRegex(emailLocal)}$`, $options: 'i' } },
        { assignedTo: { $regex: `^${escapeRegex(lowerEmail)}$`, $options: 'i' } }
      ];
      if (selfName) {
        patterns.push({ assignedTo: { $regex: `^${escapeRegex(selfName)}$`, $options: 'i' } });
      }

      // [FIX] Removed unassignedPatterns. Users should only see their assigned tasks.
      // Including unassigned tasks causes pagination/limit issues where relevant tasks are pushed out.
      // filterAndFormatTasks likely hides unassigned ones anyway.

      return { $or: patterns };
    }

    const emailParts = emailLocal.split('.');
    const firstLast = emailParts.length >= 2
      ? `${emailParts[0].charAt(0).toUpperCase()}${emailParts[0].slice(1)} ${emailParts[1].charAt(0).toUpperCase()}${emailParts[1].slice(1)}`
      : `${emailParts[0].charAt(0).toUpperCase()}${emailParts[0].slice(1)}`;

    return {
      $or: [
        { assignedTo: { $regex: `^${escapeRegex(emailLocal)}$`, $options: 'i' } },
        { assignedTo: { $regex: `^${escapeRegex(lowerEmail)}$`, $options: 'i' } },
        { assignedTo: { $regex: `^${escapeRegex(firstLast)}$`, $options: 'i' } },
      ],
    };
  }

  deriveDisplayNameFromEmail(email = '') {
    const local = email.split('@')[0];
    const parts = local.split(/[._\s-]+/).filter(Boolean);
    if (parts.length === 0) {
      return '';
    }
    return parts
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
      .join(' ');
  }

  setupChangeStream(io, userModel) {
    try {
      const changeStream = this.collection.watch(
        [
          { $match: { operationType: { $in: ["insert", "update", "replace"] } } },
        ],
        { fullDocument: "updateLookup", fullDocumentBeforeChange: "required" }
      );

      changeStream.on("change", async (change) => {
        try {
          // 1. Prepare New State
          let docNew = null;
          if (["insert", "update", "replace"].includes(change.operationType)) {
            docNew = change.fullDocument;
          }

          // 2. Prepare Old State (Pre-Image)
          let docOld = null;
          if (["update", "replace"].includes(change.operationType)) {
            docOld = change.fullDocumentBeforeChange;
          }

          // Format both to ensure derived fields (like assignedEmail) are available for permission checks
          const taskNew = docNew ? this.formatTask(docNew) : null;
          const taskOld = docOld ? this.formatTask(docOld) : null;

          // If current state is invalid/null (e.g. deleted or formatting error), we can't show it.
          // But if it was an update that made it invalid, we might need to send removals.
          // For simplicity, if taskNew is null but taskOld was valid, we treat as removal.

          const eventType = change.operationType === "insert" ? "taskCreated" : "taskUpdated";
          const taskId = (taskNew && taskNew._id) || (taskOld && taskOld._id) || change.documentKey._id;

          logger.debug('Task change detected (Diffing)', {
            eventType,
            taskId,
            operation: change.operationType
          });

          // 3. Iterate Sockets & Diff Persistence
          const sockets = io.of("/").sockets;
          if (!sockets || sockets.size === 0) return;

          for (const socket of sockets.values()) {
            const user = socket.data.user;
            if (!user) continue;

            const visibleBefore = taskOld ? this.shouldSendTaskToUser(user, taskOld, userModel) : false;
            const visibleAfter = taskNew ? this.shouldSendTaskToUser(user, taskNew, userModel) : false;

            if (visibleBefore && !visibleAfter) {
              // CASE: User lost access (or task deleted/invalidated)
              socket.emit("taskRemoved", { _id: taskId });
              logger.debug('Emitted taskRemoved', { userEmail: user.email, taskId });
            } else if (visibleAfter) {
              // CASE: User has access now (New or Kept)
              // We send the FULL payload. The client will treat this as a signal to re-fetch canonical
              // if it follows the "Signal -> Fetch" pattern, or upsert directly if it trusts this.
              // To support "Signal Only", sending the full task is still fine (contains _id).
              socket.emit(eventType, taskNew);

              // Debug logging only for interesting transitions
              if (!visibleBefore) {
                logger.debug('Emitted task access GAINED', { userEmail: user.email, taskId, event: eventType });
              }
            }
          }

        } catch (error) {
          logger.error('Change stream processing error', { error: error.message, stack: error.stack });
        }
      });

      changeStream.on("error", (error) => {
        logger.error('Task change stream error', { error: error.message });
      });

      logger.info('Task realtime updates configured with Visibility Diffing');
    } catch (error) {
      logger.error('Failed to setup task change stream', { error: error.message });
    }
  }

  shouldSendTaskToUser(user, task, userModel) {
    const lowerEmail = user.email.toLowerCase();
    const assignedEmail = (task.assignedEmail || task.assignedToEmail || task.assignedTo || '').toLowerCase();

    if (user.role === "admin") {
      return true;
    }

    if (assignedEmail && lowerEmail === assignedEmail) {
      return true;
    }

    const normalizedRole = (user.role || '').toLowerCase();

    if (normalizedRole === 'lead' || normalizedRole === 'am') {
      const teamEmails = userModel
        .getTeamEmails(user.email, user.role, user.teamLead)
        .map((email) => (email || '').toLowerCase());

      if (teamEmails.includes((assignedEmail || '').toLowerCase())) {
        return true;
      }

      const norm = (value = '') =>
        value
          .toString()
          .trim()
          .toLowerCase()
          .split('@')[0]
          .replace(/[^a-z0-9]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const teamTokens = new Set();
      for (const email of teamEmails) {
        if (!email) continue;
        const local = email.split('@')[0];
        const display = this.deriveDisplayNameFromEmail(email);
        for (const candidate of [local, display]) {
          const normalized = norm(candidate);
          if (!normalized) continue;
          teamTokens.add(normalized);
          const pieces = normalized.split(' ').filter(Boolean);
          for (const piece of pieces) {
            teamTokens.add(piece);
          }
        }
      }

      const suggestionStrings = [
        ...(Array.isArray(task.suggestions) ? task.suggestions : []),
        task.candidateExpertDisplay || ''
      ].filter(Boolean);

      for (const suggestion of suggestionStrings) {
        const normalizedSuggestion = norm(suggestion);
        if (!normalizedSuggestion) continue;
        if (teamTokens.has(normalizedSuggestion)) {
          return true;
        }

        for (const piece of normalizedSuggestion.split(' ')) {
          if (teamTokens.has(piece)) {
            return true;
          }
        }
      }

      return false;
    }

    if (normalizedRole === 'recruiter') {
      const localPart = lowerEmail.split('@')[0];
      const displayName = this.deriveDisplayNameFromEmail(lowerEmail).toLowerCase();
      const haystack = [task.sender, task.cc, task.to, task.assignedTo, task.assignedExpert]
        .filter(Boolean)
        .map((value) => value.toString().toLowerCase())
        .join(' ');

      if (haystack.includes(lowerEmail) || haystack.includes(localPart)) {
        return true;
      }

      if (displayName && haystack.includes(displayName)) {
        return true;
      }

      return false;
    }

    return false;
  }
}

export const taskModel = new TaskModel();
