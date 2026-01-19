import { taskService } from '../services/taskService.js';
import { thanksMailService } from '../services/thanksMailService.js';
import { interviewerQuestionService } from '../services/interviewerQuestionService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

export class TaskController {
  constructor() {
    this.taskService = taskService;
  }

  getTasks = asyncHandler(async (req, res) => {
    const user = req.user;
    const { tab = "Date of Interview" } = req.query;

    const result = await this.taskService.getTasksForUser(
      user.email,
      user.role,
      user.teamLead,
      user.manager,
      tab
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
      user.teamLead
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

  healthCheck = asyncHandler(async (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Task service is healthy',
      timestamp: new Date().toISOString()
    });
  });
}

export const taskController = new TaskController();
