import { asyncHandler } from '../middleware/errorHandler.js';
import { interviewSupportAdminService } from '../services/interviewSupportAdminService.js';
import { logger } from '../utils/logger.js';

class InterviewSupportAdminController {
  listTasks = asyncHandler(async (req, res) => {
    const { page, limit, status, candidateName, dateFrom, dateTo } = req.query;
    const result = await interviewSupportAdminService.listTasks({
      page, limit, status, candidateName, dateFrom, dateTo,
    });
    res.json({ success: true, ...result });
  });

  getTaskDetail = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const result = await interviewSupportAdminService.getTaskDetail(taskId);
    if (!result) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    res.json({ success: true, ...result });
  });

  updateTaskStatus = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, error: 'status is required' });
    }
    const result = await interviewSupportAdminService.updateTaskStatus(taskId, status, req.user.email);
    res.json({ success: true, ...result });
  });

  retryAutoAssign = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const result = await interviewSupportAdminService.retryAutoAssign(taskId, req.user.email);
    res.json({ success: true, ...result });
  });

  // Manual auto-assign trigger that mirrors Intervue's POST /api/reply
  // payload shape ({ subject, targetTo, customBodyHtml }) — for use when
  // Intervue's own auto-dispatch failed or was skipped on a Pending task.
  manualTriggerAutoAssign = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    try {
      const result = await interviewSupportAdminService.manualTriggerAutoAssign(taskId, req.user.email);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  getUnprocessed = asyncHandler(async (req, res) => {
    const { date } = req.query;
    const result = await interviewSupportAdminService.getUnprocessedEmails(date);
    res.json({ success: true, ...result });
  });

  pushUnprocessed = asyncHandler(async (req, res) => {
    const { emails } = req.body;
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ success: false, error: 'emails array is required' });
    }
    const result = await interviewSupportAdminService.pushUnprocessedToKafka(emails);
    res.json({ success: true, ...result });
  });

  getFailedAssigns = asyncHandler(async (req, res) => {
    const { date } = req.query;
    const result = await interviewSupportAdminService.getFailedAutoAssigns(date);
    res.json({ success: true, ...result });
  });

  getStats = asyncHandler(async (req, res) => {
    const { date } = req.query;
    const result = await interviewSupportAdminService.getStats(date);
    res.json({ success: true, ...result });
  });

  getSubjectAudit = asyncHandler(async (req, res) => {
    const { subject, limit } = req.query;
    if (!subject) {
      return res.status(400).json({ success: false, error: 'subject is required' });
    }
    const result = await interviewSupportAdminService.getSubjectAudit(subject, limit);
    res.json({ success: true, ...result });
  });

  reprocessSubject = asyncHandler(async (req, res) => {
    const { subject, mode = 'assign' } = req.body || {};
    if (!subject) {
      return res.status(400).json({ success: false, error: 'subject is required' });
    }
    const auth = req.headers.authorization || '';
    const userAssertion = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!userAssertion) {
      return res.status(401).json({ success: false, error: 'missing_bearer' });
    }
    try {
      const result = await interviewSupportAdminService.reprocessSubject({
        subject,
        mode,
        userAssertion,
        adminEmail: req.user.email,
      });
      res.json({ success: true, ...result });
    } catch (err) {
      logger.error('reprocessSubject failed', { subject, mode, error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

export const interviewSupportAdminController = new InterviewSupportAdminController();
