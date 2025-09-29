import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import moment from 'moment-timezone';

function escapeRegex(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class TaskModel {
  constructor() {
    this.collection = null;
  }

  async initialize() {
    this.collection = database.getCollection('taskBody');
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

      return {
        ...doc,
        assignedExpert,
        assignedEmail,
        assignedAt,
        startTime: startMoment,
        endTime: endMoment,
      };
    } catch (error) {
      logger.error('Error formatting task', { error: error.message, taskId: doc._id });
      return null;
    }
  }

  async getTasksForUser(userEmail, userRole, teamEmails, manager, tab = "Date of Interview", targetDate) {
    try {
      const targetMoment = targetDate
        ? moment(targetDate).tz('America/New_York')
        : moment.tz('America/New_York');

      if (!targetMoment.isValid()) {
        throw new Error('Invalid target date provided');
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

      logger.debug('Executing task query', { userEmail, query });

      const docs = await this.collection
        .aggregate([
          { $match: query },
          {
            $lookup: {
              from: 'transcripts',
              localField: 'subject',
              foreignField: 'title',
              as: 'transcripts'
            }
          },
          {
            $addFields: {
              transcription: {
                $gt: [{ $size: '$transcripts' }, 0]
              }
            }
          },
          { $unset: ['replies', 'body', 'transcripts'] }
        ])
        .toArray();

      const tasks = this.filterAndFormatTasks(docs, userEmail, userRole, teamEmails);

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

      return {
        $or: [
          { cc: { $regex: ccVal, $options: "i" } },
          { sender: { $regex: ccVal, $options: "i" } }
        ]
      };
    } else if (userRole === "mlead") {
      return {
        $or: [
          { cc: { $regex: lowerEmail, $options: "i" } },
          { sender: { $regex: lowerEmail, $options: "i" } },
        ],
      };
    } else {
      return {};
    }
  }

  filterAndFormatTasks(docs, userEmail, userRole, teamEmails = []) {
    const tasks = [];
    const userEmailLower = userEmail.toLowerCase();
    const normalizedRole = (userRole || '').toLowerCase();
    const teamEmailSet = new Set((teamEmails || []).map((email) => email.toLowerCase()));

    for (const doc of docs) {
      const task = this.formatTask(doc);
      if (!task) continue;

      if (['mam', 'mm', 'mlead'].includes(normalizedRole)) {
        const localPart = doc.sender.toLowerCase().split("@")[0];
        const parts = localPart.split(".");

        let recruiterName;
        if (parts.length >= 2) {
          const [first, last] = parts;
          recruiterName = `${first[0].toUpperCase()}${first.slice(1)} ${last[0].toUpperCase()}${last.slice(1)}`;
        } else {
          const only = parts[0];
          recruiterName = `${only[0].toUpperCase()}${only.slice(1)}`;
        }

        tasks.push({ ...task, recruiterName });
        continue;
      }

      if (normalizedRole === 'recruiter') {
        const senderLower = (doc.sender || '').toLowerCase();
        if (senderLower === userEmailLower) {
          tasks.push(task);
          continue;
        }
        const assignedEmailLower = task.assignedEmail?.toLowerCase() || "";
        if (assignedEmailLower === userEmailLower) {
          tasks.push(task);
        }
        continue;
      }

      const assignedEmailLower = task.assignedEmail?.toLowerCase() || "";
      const isAdmin = normalizedRole === 'admin';
      const isSelf = userEmailLower === assignedEmailLower;
      const isOnTeam = teamEmailSet.has(assignedEmailLower);

      if (isAdmin || isSelf || isOnTeam) {
        tasks.push(task);
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

      return {
        $or: [
          { cc: { $regex: escapeRegex(ccVal), $options: 'i' } },
          { sender: { $regex: escapeRegex(ccVal), $options: 'i' } },
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

    if (['lead', 'am', 'recruiter'].includes(normalizedRole)) {
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
      const changeStream = this.collection.watch([
        { $match: { operationType: { $in: ["insert", "update"] } } },
      ]);

      changeStream.on("change", async (change) => {
        try {
          const doc = change.operationType === "insert"
            ? change.fullDocument
            : await this.collection.findOne({ _id: change.documentKey._id });

          const formatted = this.formatTask(doc);
          if (!formatted) return;

          const event = change.operationType === "insert" ? "taskCreated" : "taskUpdated";

          logger.debug('Task change detected', {
            event,
            taskId: formatted._id,
            assignedEmail: formatted.assignedEmail
          });

          this.emitToRelevantUsers(io, userModel, event, formatted);
        } catch (error) {
          logger.error('Change stream processing error', { error: error.message });
        }
      });

      changeStream.on("error", (error) => {
        logger.error('Task change stream error', { error: error.message });
      });

    } catch (error) {
      logger.error('Failed to setup task change stream', { error: error.message });
    }
  }

  emitToRelevantUsers(io, userModel, event, task) {
    for (const socket of io.of("/").sockets.values()) {
      const user = socket.data.user;
      if (!user) continue;

      if (this.shouldSendTaskToUser(user, task.assignedEmail, userModel)) {
        socket.emit(event, task);
        logger.debug('Task emitted to user', {
          event,
          userEmail: user.email,
          taskId: task._id
        });
      }
    }
  }

  shouldSendTaskToUser(user, assignedEmail, userModel) {
    const lowerEmail = user.email.toLowerCase();

    if (user.role === "admin") {
      return true;
    }

    if (lowerEmail === assignedEmail?.toLowerCase()) {
      return true;
    }

    const normalizedRole = (user.role || '').toLowerCase();

    if (normalizedRole === 'lead' || normalizedRole === 'am') {
      const teamEmails = userModel
        .getTeamEmails(user.email, user.role, user.teamLead)
        .map((email) => email.toLowerCase());
      return teamEmails.includes((assignedEmail || '').toLowerCase());
    }

    return false;
  }
}

export const taskModel = new TaskModel();
