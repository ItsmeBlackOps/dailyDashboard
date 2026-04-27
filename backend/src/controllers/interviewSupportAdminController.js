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
}

export const interviewSupportAdminController = new InterviewSupportAdminController();
