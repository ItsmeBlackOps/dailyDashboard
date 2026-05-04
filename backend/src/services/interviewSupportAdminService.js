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
  // manualTriggerAutoAssign
  //
  // POSTs to the Intervue-format auto-assign endpoint
  // (auto.silverspace.tech/api/reply by default) with the same payload
  // shape Intervue itself uses: { subject, targetTo, customBodyHtml }.
  //
  // Used by the admin "Trigger auto-assign" action on Pending tasks
  // when Intervue's automatic dispatch failed or was skipped.
  // -----------------------------------------------------------------------
  async manualTriggerAutoAssign(taskId, adminEmail) {
    const taskCol      = database.getCollection('taskBody');
    const candidateCol = database.getCollection('candidateDetails');
    const auditCol     = database.getCollection('auditLog');

    let oid;
    try { oid = new ObjectId(taskId); } catch { oid = taskId; }

    const task = await taskCol.findOne({ _id: oid });
    if (!task) throw new Error('Task not found');

    const subject = task['Subject'] || task['subject'] || '';
    if (!subject) throw new Error('Task has no subject');

    const candidateName = task['Candidate Name'] || task.candidateName || '';
    const senderEmail   = task.sender || task['Email ID'] || '';

    // Resolve expert email from candidateDetails (matches Intervue's
    // try_auto_assign lookup logic).
    let expertEmail = '';
    let expertName  = '';
    if (candidateCol && candidateName) {
      const cand = await candidateCol.findOne({
        'Candidate Name': { $regex: `^${candidateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
      });
      if (cand) {
        expertEmail = (cand.Expert || '').trim();
        if (expertEmail) {
          // Derive a friendly display name from the email local-part.
          const local = expertEmail.split('@')[0] || '';
          expertName = local
            .split(/[._-]+/)
            .filter(Boolean)
            .map((s) => s[0].toUpperCase() + s.slice(1).toLowerCase())
            .join(' ') || expertEmail;
        }
      }
    }

    if (!expertEmail) {
      throw new Error(`No Expert assigned for candidate "${candidateName}" — set Expert on the candidate first`);
    }

    // Mirror Intervue's HTML body shape: simple "Assigned To @Expert" greeting.
    // The auto-assign service will prepend this to the quoted-original
    // thread when it builds the replyAll MIME.
    const customBodyHtml = `<p>Assigned To <b>@${expertName}</b></p>` +
      `<p>Please confirm and join at the scheduled time.</p>`;

    const replyUrl = config.autoAssign.replyUrl;
    if (!replyUrl) throw new Error('AUTO_REPLY_ENDPOINT (autoAssign.replyUrl) not configured');

    const now = new Date();
    let response = null;
    let httpStatus = null;
    let error = null;
    try {
      const resp = await fetch(replyUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          subject,
          targetTo:        senderEmail,    // recruiter who originally requested
          customBodyHtml,
        }),
      });
      httpStatus = resp.status;
      const text = await resp.text();
      try { response = JSON.parse(text); } catch { response = { raw: text }; }
      if (!resp.ok) {
        error = `auto-assign returned ${resp.status}: ${text.slice(0, 300)}`;
      }
    } catch (err) {
      error = `auto-assign request exception: ${err.message}`;
      logger.error('manualTriggerAutoAssign request failed', { taskId, error });
    }

    await auditCol.insertOne({
      subject,
      taskId:        taskId.toString(),
      action:        error ? 'AUTO_ASSIGN_FAILED' : 'AUTO_ASSIGN_SENT',
      phase:         error ? 'AUTO_ASSIGN_FAILED' : 'AUTO_ASSIGN_SENT',
      adminEmail,
      triggeredBy:   'admin-manual',
      expertEmail,
      targetTo:      senderEmail,
      httpStatus,
      response_body_preview: typeof response === 'object' ? JSON.stringify(response).slice(0, 500) : undefined,
      error_details: error || undefined,
      level:         error ? 'error' : 'info',
      createdAt:     now,
    });

    if (error) throw new Error(error);
    return { success: true, expertEmail, targetTo: senderEmail, response };
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
        const kafkaValue = {
          subject:          email.subject || email.Subject || '',
          from:             email.from?.emailAddress?.address || email.sender || '',
          receivedDateTime: email.receivedDateTime || new Date().toISOString(),
          body:             cleanedBody,
          emailId:          email.id || '',
        };
        // Honoured by Intervue's reprocess guard — when true, app.py creates
        // the task and stops before submitting to the auto-assign executor.
        if (email.skip_auto_assign === true) {
          kafkaValue.skip_auto_assign = true;
        }
        const kafkaPayload = { records: [{ value: kafkaValue }] };

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
  // getLogs — returns processing logs + counters in the shape the
  // frontend's "Processing Logs" tab expects:
  //   { stats: { totalProcessed, totalFailed, totalPending, totalAssigned },
  //     logs:  ProcessingLogEntry[] }
  // Adapter over the raw auditLog schema (phase/detail/timestamp/extra)
  // to the frontend's (action/details/timestamp/level) shape. Counters
  // are computed against the same day's audit window, not all-time.
  // -----------------------------------------------------------------------
  async getLogs(date) {
    const auditCol = database.getCollection('auditLog');
    const filterDate = date || new Date().toISOString().slice(0, 10);
    const start = new Date(`${filterDate}T00:00:00Z`);
    const end   = new Date(`${filterDate}T23:59:59Z`);

    const rows = await auditCol.find({ timestamp: { $gte: start, $lte: end } })
      .sort({ timestamp: -1 })
      .limit(2000)
      .toArray();

    const PROCESSED_PHASES = new Set([
      'CREATED', 'EXTRACTED', 'AUTO_ASSIGN_SUCCESS', 'REPLY_SUCCESS', 'SEARCH_MATCHED',
    ]);
    const FAILED_PHASES = new Set([
      'AUTO_ASSIGN_FAILED', 'AUTO_ASSIGN_5XX', 'REPLY_FAILED', 'SEARCH_NO_RESULTS',
      'SEARCH_EXHAUSTED', 'VALIDATION_FAILED', 'PO_EXTRACT_FAILED',
    ]);
    const PENDING_PHASES = new Set([
      'AUTO_ASSIGN_QUEUED', 'AUTO_ASSIGN_STARTED', 'SEARCH_RETRY_WAIT', 'SEARCH_STARTED',
    ]);
    const ASSIGNED_PHASES = new Set(['AUTO_ASSIGN_SUCCESS']);

    let totalProcessed = 0, totalFailed = 0, totalPending = 0, totalAssigned = 0;
    for (const r of rows) {
      if (PROCESSED_PHASES.has(r.phase)) totalProcessed++;
      if (FAILED_PHASES.has(r.phase))    totalFailed++;
      if (PENDING_PHASES.has(r.phase))   totalPending++;
      if (ASSIGNED_PHASES.has(r.phase))  totalAssigned++;
    }

    const logs = rows.map((r) => ({
      _id:         (r._id || '').toString(),
      action:      r.phase || 'UNKNOWN',
      // Performed-by is whichever of (extra.actor, extra.by, extra.user, system) is set.
      performedBy: (r.extra && (r.extra.actor || r.extra.by || r.extra.user || r.extra.performedBy))
                   || (r.phase && r.phase.startsWith('AUTO_ASSIGN_') ? 'auto-assign' : 'intervue'),
      timestamp:   r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
      details:     r.detail || (r.extra ? JSON.stringify(r.extra).slice(0, 280) : ''),
      // Normalize 'warn' vs 'warning' — DB has both. Frontend expects 'warn'.
      level:       r.level === 'warning' ? 'warn' : (r.level || 'info'),
    }));

    return {
      date: filterDate,
      stats: { totalProcessed, totalFailed, totalPending, totalAssigned },
      logs,
    };
  }

  // -----------------------------------------------------------------------
  // getFailedAutoAssigns
  // -----------------------------------------------------------------------
  async getFailedAutoAssigns(date) {
    // The auditLog pipeline writes { phase, timestamp, subject, ... }
    // — not { action, createdAt, taskId } as an older draft of this
    // service assumed. Schema confirmed live: 339 'AUTO_ASSIGN_FAILED'
    // rows present, all keyed by `subject`.
    const auditCol = database.getCollection('auditLog');
    const taskCol  = database.getCollection('taskBody');

    const query = { phase: 'AUTO_ASSIGN_FAILED' };
    if (date) {
      const start = new Date(`${date}T00:00:00Z`);
      const end   = new Date(`${date}T23:59:59Z`);
      query.timestamp = { $gte: start, $lte: end };
    }

    const failedAudits = await auditCol.find(query).sort({ timestamp: -1 }).toArray();

    // Enrich by subject → most recent matching taskBody row. Subjects
    // can match multiple thread replies; pick the latest by
    // receivedDateTime as the primary representation of the task.
    const subjects = [...new Set(failedAudits.map(a => a.subject).filter(Boolean))];
    let taskBySubject = {};
    if (subjects.length > 0) {
      const tasks = await taskCol.find({ subject: { $in: subjects } })
        .sort({ receivedDateTime: -1 })
        .toArray();
      for (const t of tasks) {
        // Keep the first (latest) row per subject because of the sort above.
        if (!taskBySubject[t.subject]) taskBySubject[t.subject] = t;
      }
    }

    // Frontend's FailedAssignRow shape: { _id, candidateName, technology,
    // endClient, receivedAt, failureReason }. Flatten + adapt from the
    // (audit row, task row) pair. _id is the task's _id when available
    // (lets the Retry button work) — otherwise the audit row's _id.
    const tasks = failedAudits.map((a) => {
      const task = taskBySubject[a.subject] || null;
      return {
        _id: task ? task._id.toString() : (a._id || '').toString(),
        candidateName: task?.['Candidate Name'] || a.subject || '(unknown)',
        technology:    task?.Technology || task?.['Job Title'] || '',
        endClient:     task?.['End Client'] || '',
        receivedAt:    (task?.receivedDateTime || a.timestamp instanceof Date ? a.timestamp.toISOString() : a.timestamp) || null,
        failureReason: a.detail || (a.extra ? JSON.stringify(a.extra).slice(0, 280) : ''),
        // Keep raw audit row available for any UI that wants it.
        _audit: a,
      };
    });

    return { date: date || null, total: tasks.length, tasks };
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
      // Field name is `timestamp`, not `createdAt`. And the success/fail
      // markers live on `phase`, not `action`.
      auditCol.find({ timestamp: { $gte: start, $lte: end } }).sort({ timestamp: -1 }).toArray(),
      auditCol.countDocuments({ phase: 'AUTO_ASSIGN_FAILED', timestamp: { $gte: start, $lte: end } }),
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

  // -----------------------------------------------------------------------
  // getSubjectAudit — every auditLog row for a given subject, oldest-first.
  // Unified view of Intervue + Auto-Assign activity since Intervue records
  // Auto-Assign HTTP responses into auditLog (AUTO_ASSIGN_5XX/SUCCESS/FAILED).
  // -----------------------------------------------------------------------
  async getSubjectAudit(subject, limit = 200) {
    if (!subject) return { subject, rows: [] };
    const auditCol = database.getCollection('auditLog');
    const rows = await auditCol
      .find({ subject })
      .sort({ timestamp: 1 })
      .limit(Math.max(1, Math.min(1000, parseInt(limit, 10) || 200)))
      .toArray();
    return { subject, rows };
  }

  // -----------------------------------------------------------------------
  // reprocessSubject — wipe + republish a subject through Kafka/Intervue.
  // mode='assign'    → normal flow, expert auto-assigned.
  // mode='no-assign' → adds skip_auto_assign:true so Intervue's guard at
  //                    app.py:461 creates the task without assigning.
  // -----------------------------------------------------------------------
  async reprocessSubject({ subject, mode = 'assign', userAssertion, adminEmail }) {
    if (!subject || typeof subject !== 'string') {
      throw new Error('subject is required');
    }
    if (!['assign', 'no-assign'].includes(mode)) {
      throw new Error('mode must be assign or no-assign');
    }
    if (!userAssertion) {
      throw new Error('user assertion (Bearer token) is required for Graph search');
    }

    const { graphMeetingService } = await import('./graphMeetingService.js');
    const messages = await graphMeetingService.searchMessagesBySubject(userAssertion, subject, 90, 50);

    if (messages.length === 0) {
      return {
        subject,
        mode,
        deletedTask: 0,
        deletedAuditRows: 0,
        pushed: 0,
        failed: 0,
        results: [],
        warning: 'No messages found in your mailbox for this subject in the last 90 days',
      };
    }

    const taskCol  = database.getCollection('taskBody');
    const auditCol = database.getCollection('auditLog');

    const deletedTask  = await taskCol.deleteMany({ $or: [{ Subject: subject }, { subject }] });
    const deletedAudit = await auditCol.deleteMany({ subject });

    const skipFlag = mode === 'no-assign';
    const adapted = messages.map(m => ({
      id:               m.id,
      subject:          m.subject || subject,
      from:             m.from,
      receivedDateTime: m.receivedDateTime,
      body:             m.body,
      rawBody:          typeof m.body?.content === 'string' ? m.body.content : '',
      skip_auto_assign: skipFlag,
    }));

    const kafkaResult = await this.pushUnprocessedToKafka(adapted);

    await auditCol.insertOne({
      subject,
      action:         'REPROCESS_TRIGGERED',
      phase:          'REPROCESS_TRIGGERED',
      adminEmail,
      mode,
      messagesPushed: kafkaResult.pushed,
      messagesFailed: kafkaResult.failed,
      createdAt:      new Date(),
      level:          'info',
    });

    if (this.io) {
      this.io.emit('interviewSupportTaskUpdated', { subject, action: 'REPROCESS_TRIGGERED' });
    }

    return {
      subject,
      mode,
      deletedTask:      deletedTask.deletedCount || 0,
      deletedAuditRows: deletedAudit.deletedCount || 0,
      pushed:           kafkaResult.pushed,
      failed:           kafkaResult.failed,
      results:          kafkaResult.results,
    };
  }
}

export const interviewSupportAdminService = new InterviewSupportAdminService();
