import express from 'express';
import { taskController } from '../controllers/taskController.js';
import { authenticateHTTP, requireHTTPRole } from '../middleware/auth.js';
import { transcriptRequestController } from '../controllers/transcriptRequestController.js';

const router = express.Router();

// All task routes require authentication
router.use(authenticateHTTP);

// Task routes
router.get('/', taskController.getTasks);
router.get('/health', taskController.healthCheck);
router.get('/statistics', taskController.getTaskStatistics);
router.get('/dashboard-summary', taskController.getDashboardSummary);
router.get('/upcoming', taskController.getUpcomingUnstarted);
router.post('/transcript-requests/status', transcriptRequestController.getMyTranscriptRequestStatuses);
router.get('/:taskId/interview-debrief', taskController.getInterviewDebriefStatus);
router.get('/:taskId/transcript-request', transcriptRequestController.getMyTranscriptRequestStatus);
router.get('/:taskId/transcript', transcriptRequestController.getTaskTranscript);
router.patch('/:taskId/meeting-link', taskController.updateMeetingLink);
router.post('/:taskId/ensure-meeting', taskController.ensureMeeting);
router.patch('/:taskId/meeting-started', taskController.markMeetingStarted);
// Co-assignees — second expert on a task (2026-06-12 spec). Authority
// rules live in taskService (admin / expert's own lead instant; others
// pending with the expert's lead as approver).
router.post('/:taskId/co-assignees', taskController.addCoAssignee);
router.post('/:taskId/co-assignees/:email/approve', taskController.approveCoAssignee);
router.post('/:taskId/co-assignees/:email/reject', taskController.rejectCoAssignee);
router.delete('/:taskId/co-assignees/:email', taskController.removeCoAssignee);
router.get('/:taskId', taskController.getTaskById);

router.post('/search', taskController.searchTasks);
router.post('/:taskId/thanks-mail', taskController.generateThanksMail);
router.post('/:taskId/interviewer-questions', taskController.getInterviewerQuestions);
router.post('/:taskId/interview-debrief', taskController.getInterviewDebrief);
router.post('/:taskId/transcript-request', transcriptRequestController.createTranscriptRequest);
router.delete('/:taskId', taskController.deleteTask);

export default router;
