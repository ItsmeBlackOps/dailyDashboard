import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

class InterviewSupportAdminService {
  constructor() {
    this.io = null;
  }

  setupRealtimeUpdates(io) {
    this.io = io;
    logger.info('InterviewSupportAdminService: realtime updates configured');
  }

  // -----------------------------------------------------------------------
  // listTasks
  // -----------------------------------------------------------------------
  async listTasks({ page = 1, limit = 20, status, candidateName, dateFrom, dateTo } = {}) {
    const col = database.getCollection('taskBody');
    const query = {};

    if (status) query['Status'] = status;
    if (candidateName) query['Candidate Name'] = { $regex: candidateName, $options: 'i' };
    if (dateFrom || dateTo) {
      query['Date of Interview'] = {};
      if (dateFrom) query['Date of Interview'].$gte = dateFrom;
      if (dateTo)   query['Date of Interview'].$lte = dateTo;
    }

    const pageNum  = Math.max(1, parseInt(page, 10)  || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);
    const skip     = (pageNum - 1) * limitNum;

    const [tasks, total] = await Promise.all([
      col.find(query).sort({ _id: -1 }).skip(skip).limit(limitNum).toArray(),
      col.countDocuments(query),
    ]);

    return {
      tasks,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
    };
  }

  // -----------------------------------------------------------------------
  // getTaskDetail
  // -----------------------------------------------------------------------
  async getTaskDetail(taskId) {
    const taskCol  = database.getCollection('taskBody');
    const auditCol = database.getCollection('auditLog');

    let oid;
    try { oid = new ObjectId(taskId); } catch { oid = taskId; }

    const task = await taskCol.findOne({ _id: oid });
    if (!task) return null;

    const subject    = task['Subject'] || task['subject'] || '';
    const auditTrail = subject
      ? await auditCol.find({ subject }).sort({ createdAt: -1 }).toArray()
      : [];

    return { task, auditTrail };
  }

  // -----------------------------------------------------------------------
  // updateTaskStatus
  // -----------------------------------------------------------------------
  async updateTaskStatus(taskId, newStatus, adminEmail) {
    const taskCol  = database.getCollection('taskBody');
    const auditCol = database.getCollection('auditLog');

    let oid;
    try { oid = new ObjectId(taskId); } catch { oid = taskId; }

    const task = await taskCol.findOne({ _id: oid });
    if (!task) throw new Error('Task not found');

    const prevStatus = task['Status'];
    const now        = new Date();

    await taskCol.updateOne({ _id: oid }, {
      $set: { 'Status': newStatus, updatedAt: now },
    });

    const auditEntry = {
      subject:    task['Subject'] || task['subject'] || '',
      taskId:     taskId.toString(),
      action:     'STATUS_OVERRIDE',
      prevStatus,
      newStatus,
      adminEmail,
      createdAt:  now,
    };
    await auditCol.insertOne(auditEntry);

    if (this.io) {
      this.io.emit('interviewSupportTaskUpdated', { taskId: taskId.toString(), newStatus, adminEmail });
    }

    return { success: true, prevStatus, newStatus };
  }

  // -----------------------------------------------------------------------
  // retryAutoAssign
  // -----------------------------------------------------------------------
  async retryAutoAssign(taskId, adminEmail) {
    const taskCol  = database.getCollection('taskBody');
    const auditCol = database.getCollection('auditLog');

    let oid;
    try { oid = new ObjectId(taskId); } catch { oid = taskId; }

    const task = await taskCol.findOne({ _id: oid });
    if (!task) throw new Error('Task not found');

    const now = new Date();
    let assignResult = null;
    let error = null;

    try {
      if (!config.autoAssign.url) throw new Error('AUTO_ASSIGN_URL not configured');

      const resp = await fetch(config.autoAssign.url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ taskId: taskId.toString(), task }),
      });

      if (!resp.ok) throw new Error(`Auto-assign responded ${resp.status}`);
      assignResult = await resp.json();
    } catch (err) {
      error = err.message;
      logger.warn('retryAutoAssign failed', { taskId, error: err.message });
    }

    const auditEntry = {
      subject:    task['Subject'] || task['subject'] || '',
      taskId:     taskId.toString(),
      action:     error ? 'AUTO_ASSIGN_FAILED' : 'AUTO_ASSIGN_RETRY',
      adminEmail,
      error:      error || undefined,
      result:     assignResult || undefined,
      createdAt:  now,
    };
    await auditCol.insertOne(auditEntry);

    if (error) throw new Error(`Auto-assign retry failed: ${error}`);
    return { success: true, assignResult };
  }

  // -----------------------------------------------------------------------
  // getUnprocessedEmails
  // -----------------------------------------------------------------------
  async getUnprocessedEmails(date) {
    // Build date filter
    const filterDate = date || new Date().toISOString().slice(0, 10);
    const startIso   = `${filterDate}T00:00:00Z`;
    const endIso     = `${filterDate}T23:59:59Z`;
    const odataFilter = `receivedDateTime ge ${startIso} and receivedDateTime le ${endIso}`;

    // Fetch all emails from Outlook via Pica passthrough
    const allEmails = [];
    let nextUrl = null;

    const baseUrl = `${config.pica.baseUrl}/me/mailFolders/Inbox/messages`;
    const initialParams = new URLSearchParams({
      '$filter': odataFilter,
      '$top':    '500',
    });
    let url = `${baseUrl}?${initialParams.toString()}`;

    const headers = {
      'x-pica-secret':          config.pica.secretKey,
      'x-pica-connection-key':  config.pica.outlookConnectionKey,
      'x-pica-action-id':       config.pica.actionId,
      'Content-Type':           'application/json',
    };

    do {
      const fetchUrl = nextUrl || url;
      const resp = await fetch(fetchUrl, { method: 'GET', headers });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Pica Outlook fetch failed (${resp.status}): ${text}`);
      }

      const data = await resp.json();
      const value = data.value || [];
      allEmails.push(...value);
      nextUrl = data['@odata.nextLink'] || null;
    } while (nextUrl);

    // Diff against MongoDB
    const taskCol  = database.getCollection('taskBody');
    const auditCol = database.getCollection('auditLog');

    const existingSubjects = new Set(
      (await taskCol.distinct('Subject', {})).concat(
        await taskCol.distinct('subject', {})
      )
    );

    const auditSubjects = new Set(
      await auditCol.distinct('subject', {})
    );

    const unprocessed = allEmails.filter(email => {
      const subj = email.subject || email.Subject || '';
      return !existingSubjects.has(subj) && !auditSubjects.has(subj);
    });

    return { date: filterDate, total: allEmails.length, unprocessed };
  }

  // -----------------------------------------------------------------------
  // pushUnprocessedToKafka
  // -----------------------------------------------------------------------
  async pushUnprocessedToKafka(emailsPayload) {
    const results = [];

    for (const email of emailsPayload) {
      try {
        // Clean body via Power Automate
        let cleanedBody = email.body?.content || email.rawBody || '';

        if (config.pica.powerAutomateUrl) {
          const paResp = await fetch(config.pica.powerAutomateUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ body: cleanedBody }),
          });

          if (paResp.ok) {
            const contentType = paResp.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              const paData = await paResp.json();
              cleanedBody  = paData.cleanedBody || cleanedBody;
            } else {
              cleanedBody  = (await paResp.text()) || cleanedBody;
            }
          }
        }

        // Push to Kafka REST
        const kafkaPayload = {
          records: [
            {
              value: {
                subject:          email.subject || email.Subject || '',
                from:             email.from?.emailAddress?.address || email.sender || '',
                receivedDateTime: email.receivedDateTime || new Date().toISOString(),
                body:             cleanedBody,
                emailId:          email.id || '',
              },
            },
          ],
        };

        const kafkaResp = await fetch(`${config.kafka.restUrl}/records`, {
          method:  'POST',
          headers: {
            'Authorization': config.kafka.restAuth,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify(kafkaPayload),
        });

        if (!kafkaResp.ok) {
          const text = await kafkaResp.text();
          throw new Error(`Kafka REST responded ${kafkaResp.status}: ${text}`);
        }

        const kafkaData = await kafkaResp.json();
        results.push({ emailId: email.id, success: true, kafka: kafkaData });

        // Audit
        const auditCol = database.getCollection('auditLog');
        await auditCol.insertOne({
          subject:   email.subject || email.Subject || '',
          action:    'PUSHED_TO_KAFKA',
          emailId:   email.id,
          createdAt: new Date(),
        });
      } catch (err) {
        logger.error('pushUnprocessedToKafka error', { emailId: email.id, error: err.message });
        results.push({ emailId: email.id, success: false, error: err.message });
      }
    }

    return { pushed: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, results };
  }

  // -----------------------------------------------------------------------
  // getFailedAutoAssigns
  // -----------------------------------------------------------------------
  async getFailedAutoAssigns(date) {
    const auditCol = database.getCollection('auditLog');
    const taskCol  = database.getCollection('taskBody');

    const query = { action: 'AUTO_ASSIGN_FAILED' };
    if (date) {
      const start = new Date(`${date}T00:00:00Z`);
      const end   = new Date(`${date}T23:59:59Z`);
      query.createdAt = { $gte: start, $lte: end };
    }

    const failedAudits = await auditCol.find(query).sort({ createdAt: -1 }).toArray();

    // Enrich with task data
    const taskIds = [...new Set(failedAudits.map(a => a.taskId).filter(Boolean))];
    const oids    = taskIds.map(id => { try { return new ObjectId(id); } catch { return id; } });
    const tasks   = await taskCol.find({ _id: { $in: oids } }).toArray();
    const taskMap = Object.fromEntries(tasks.map(t => [t._id.toString(), t]));

    const enriched = failedAudits.map(a => ({
      ...a,
      task: taskMap[a.taskId] || null,
    }));

    return { date: date || null, total: enriched.length, failedAutoAssigns: enriched };
  }

  // -----------------------------------------------------------------------
  // getStats
  // -----------------------------------------------------------------------
  async getStats(date) {
    const taskCol  = database.getCollection('taskBody');
    const auditCol = database.getCollection('auditLog');

    const filterDate = date || new Date().toISOString().slice(0, 10);
    const start      = new Date(`${filterDate}T00:00:00Z`);
    const end        = new Date(`${filterDate}T23:59:59Z`);

    const [
      totalTasks,
      statusBreakdown,
      auditToday,
      failedAssigns,
    ] = await Promise.all([
      taskCol.countDocuments({}),
      taskCol.aggregate([
        { $group: { _id: '$Status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      auditCol.find({ createdAt: { $gte: start, $lte: end } }).sort({ createdAt: -1 }).toArray(),
      auditCol.countDocuments({ action: 'AUTO_ASSIGN_FAILED', createdAt: { $gte: start, $lte: end } }),
    ]);

    const statusMap = Object.fromEntries(statusBreakdown.map(s => [s._id || 'Unknown', s.count]));

    return {
      date:          filterDate,
      totalTasks,
      statusBreakdown: statusMap,
      failedAutoAssignsToday: failedAssigns,
      auditEntriesCount:      auditToday.length,
      auditEntries:           auditToday,
    };
  }
}

export const interviewSupportAdminService = new InterviewSupportAdminService();
