import express from 'express';
import { taskController } from '../controllers/taskController.js';
import { authenticateHTTP, requireHTTPRole } from '../middleware/auth.js';

const router = express.Router();

// All task routes require authentication
router.use(authenticateHTTP);

// Task routes
router.get('/', taskController.getTasks);
router.get('/health', taskController.healthCheck);
router.get('/statistics', taskController.getTaskStatistics);
router.get('/dashboard-summary', taskController.getDashboardSummary);
router.get('/:taskId/interview-debrief', taskController.getInterviewDebriefStatus);
router.get('/:taskId', taskController.getTaskById);

router.post('/search', taskController.searchTasks);
router.post('/:taskId/thanks-mail', taskController.generateThanksMail);
router.post('/:taskId/interviewer-questions', taskController.getInterviewerQuestions);
router.post('/:taskId/interview-debrief', taskController.getInterviewDebrief);
router.delete('/:taskId', taskController.deleteTask);

export default router;
