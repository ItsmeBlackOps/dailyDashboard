import { ObjectId } from 'mongodb';
import { taskService } from '../services/taskService.js';
import { thanksMailService } from '../services/thanksMailService.js';
import { interviewerQuestionService } from '../services/interviewerQuestionService.js';
import { interviewDebriefService } from '../services/interviewDebriefService.js';
import { ensureMeetingForTask } from '../services/meetingProvisioningService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { database } from '../config/database.js';

export class TaskController {
  constructor() {
    this.taskService = taskService;
  }

  getTasks = asyncHandler(async (req, res) => {
    const user = req.user;
    const { tab = "Date of Interview", limit, offset } = req.query;

    const result = await this.taskService.getTasksForUser(
      user.email,
      user.role,
      user.teamLead,
      user.manager,
      tab,
      undefined,
      {
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined
      }
    );

    res.status(200).json(result);
  });

  getTaskById = asyncHandler(async (req, res) => {
    const user = req.user;
    const { taskId } = req.params;

    const result = await this.taskService.getTaskById(
      taskId,
      user.email,
      user.role,
      user.teamLead,
      user.manager
    );

    res.status(200).json(result);
  });

  searchTasks = asyncHandler(async (req, res) => {
    const user = req.user;
    const searchCriteria = req.body;

    const result = await this.taskService.searchTasks(
      user.email,
      user.role,
      user.teamLead,
      user.manager,
      searchCriteria
    );

    res.status(200).json(result);
  });

  getTaskStatistics = asyncHandler(async (req, res) => {
    const user = req.user;
    const { start, end } = req.query;

    const result = await this.taskService.getTaskStatistics(
      user.email,
      user.role,
      user.teamLead,
      user.manager,
      start,
      end
    );

    res.status(200).json(result);
  });

  getDashboardSummary = asyncHandler(async (req, res) => {
    const user = req.user;
    const { start, end, range, dateField } = req.query;

    const result = await this.taskService.getDashboardSummary(
      user.email,
      user.role,
      user.teamLead,
      user.manager,
      {
        start: Array.isArray(start) ? start[0] : start,
        end: Array.isArray(end) ? end[0] : end,
        range: Array.isArray(range) ? range[0] : range,
        dateField: Array.isArray(dateField) ? dateField[0] : dateField
      }
    );

    res.status(200).json(result);
  });

  generateThanksMail = asyncHandler(async (req, res) => {
    const { taskId } = req.params;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'Task id is required'
      });
    }

    const result = await thanksMailService.generateThanksMail({
      taskId,
      user: req.user
    });

    res.status(200).json({
      success: true,
      markdown: result.markdown,
      html: result.html,
      generatedAt: result.generatedAt,
      rateLimit: result.rateLimit
    });
  });

  getInterviewerQuestions = asyncHandler(async (req, res) => {
    const { taskId } = req.params;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'Task id is required'
      });
    }

    const result = await interviewerQuestionService.getInterviewerQuestions({
      taskId,
      user: req.user
    });

    res.status(200).json({
      success: true,
      questions: result.questions,
      generatedAt: result.generatedAt,
      rateLimit: result.rateLimit
    });
  });

  getInterviewDebrief = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const force = req.body?.force === true;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'Task id is required'
      });
    }

    const result = await interviewDebriefService.requestInterviewDebrief({
      taskId,
      user: req.user,
      force
    });

    if (result.status === 'ready') {
      return res.status(200).json({
        success: true,
        status: 'ready',
        markdown: result.markdown,
        html: result.html,
        generatedAt: result.generatedAt,
        cached: result.cached
      });
    }

    return res.status(202).json({
      success: true,
      status: result.status || 'queued',
      message: result.message || 'Interview debrief generation started in background.',
      queuedAt: result.queuedAt || null,
      startedAt: result.startedAt || null,
      error: result.error || null
    });
  });

  getInterviewDebriefStatus = asyncHandler(async (req, res) => {
    const { taskId } = req.params;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'Task id is required'
      });
    }

    const result = await interviewDebriefService.getInterviewDebriefStatus({
      taskId,
      user: req.user,
      autoQueue: true
    });

    if (result.status === 'ready') {
      return res.status(200).json({
        success: true,
        status: 'ready',
        markdown: result.markdown,
        html: result.html,
        generatedAt: result.generatedAt,
        cached: result.cached
      });
    }

    const statusCode = result.status === 'failed' ? 200 : 202;
    return res.status(statusCode).json({
      success: true,
      status: result.status || 'queued',
      message: result.message || 'Interview debrief is still processing.',
      queuedAt: result.queuedAt || null,
      startedAt: result.startedAt || null,
      error: result.error || null
    });
  });

  deleteTask = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const user = req.user;

    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'Task id is required'
      });
    }

    const result = await this.taskService.deleteTask(
      taskId,
      user.email,
      user.role
    );

    res.status(200).json(result);
  });

  updateMeetingLink = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const { meetingLink, meetingPassword } = req.body;

    if (!ObjectId.isValid(taskId)) {
      return res.status(400).json({ success: false, error: 'Invalid taskId' });
    }

    const collection = database.getCollection('taskBody');

    const update = {
      meetingLink: meetingLink || null,
      // Keep the join-link fields in sync with meetingLink. The one-meeting
      // flow persists the Teams join URL via this endpoint (not the legacy
      // saveMeetingLinks path), and the TasksToday Join/Create-Meeting button
      // reads joinUrl/joinWebUrl — without this they'd stay empty and the
      // button would wrongly show "Create Meeting" after a reload.
      joinUrl: meetingLink || null,
      joinWebUrl: meetingLink || null,
      meetingPassword: meetingPassword || null,
      botStatus: 'pending',
      botInviteAttempts: 0,
      botJoinedAt: null,
      precheckCheckedAt: null,
      botLastError: null,
      updatedAt: new Date(),
    };

    const result = await collection.findOneAndUpdate(
      { _id: new ObjectId(taskId) },
      { $set: update },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    return res.json({ success: true, task: result });
  });

  ensureMeeting = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    // Authorization carries the app session JWT (validated by authenticateHTTP).
    // The Microsoft Graph OBO assertion comes separately in x-graph-access-token
    // (same pattern as sendAssignmentEmail) — the app JWT cannot be used for OBO.
    const graphHeader = req.headers['x-graph-access-token'];
    const userAssertion = typeof graphHeader === 'string' ? graphHeader.trim() : '';
    if (!userAssertion) {
      return res.status(400).json({ success: false, error: 'Missing x-graph-access-token header' });
    }

    let result;
    try {
      result = await ensureMeetingForTask({
        taskId,
        userAssertion,
        actorEmail: req.user?.email || null,
      });
    } catch (err) {
      const status = err.statusCode || 500;
      logger.error('ensureMeeting failed', { taskId, error: err.message });
      return res.status(status).json({ success: false, error: err.message });
    }

    if (result.status === 'created') {
      return res.status(201).json({ success: true, created: true, meetingLink: result.meetingLink, joinUrl: result.meetingLink, joinWebUrl: result.meetingLink });
    }
    if (result.status === 'exists') {
      return res.status(200).json({ success: true, created: false, meetingLink: result.meetingLink, joinUrl: result.meetingLink, joinWebUrl: result.meetingLink });
    }
    return res.status(202).json({ success: true, pending: true });
  });

  // SP2 — one-way, record-only "Meeting Started" toggle. Gate: the assigned
  // expert (assignedTo) may mark their own; am/lead/admin may mark any.
  // Idempotent: once started it stays set (admin corrects out-of-band).
  markMeetingStarted = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    if (!ObjectId.isValid(taskId)) {
      return res.status(400).json({ success: false, error: 'Invalid taskId' });
    }

    const collection = database.getCollection('taskBody');
    const task = await collection.findOne({ _id: new ObjectId(taskId) });
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    const actorEmail = (req.user?.email || '').trim().toLowerCase();
    const actorRole = (req.user?.role || '').trim().toLowerCase();
    const assignedRaw = task.assignedTo || task.AssignedExpert || task.assignedExpert || '';
    const assignedEmail = String(assignedRaw).includes('@') ? String(assignedRaw).trim().toLowerCase() : '';
    const allowed = actorRole === 'admin'
      || actorRole === 'am'
      || actorRole === 'lead'
      || (actorRole === 'user' && assignedEmail && actorEmail === assignedEmail);
    if (!allowed) {
      return res.status(403).json({ success: false, error: 'Not allowed to mark this meeting started' });
    }

    if (task.meetingStarted === true) {
      return res.json({
        success: true,
        meetingStarted: true,
        meetingStartedAt: task.meetingStartedAt || null,
        meetingStartedBy: task.meetingStartedBy || null,
      });
    }

    const meetingStartedAt = new Date().toISOString();
    await collection.updateOne(
      { _id: new ObjectId(taskId) },
      { $set: { meetingStarted: true, meetingStartedAt, meetingStartedBy: actorEmail } }
    );
    return res.json({ success: true, meetingStarted: true, meetingStartedAt, meetingStartedBy: actorEmail });
  });

  healthCheck = asyncHandler(async (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Task service is healthy',
      timestamp: new Date().toISOString()
    });
  });
}

export const taskController = new TaskController();
