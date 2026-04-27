import express from 'express';
import { authenticateHTTP, requireHTTPRole } from '../middleware/auth.js';
import { interviewSupportAdminController as ctl } from '../controllers/interviewSupportAdminController.js';

const router = express.Router();

router.use(authenticateHTTP);
router.use(requireHTTPRole('admin'));

router.get('/tasks',                       (req, res) => ctl.listTasks(req, res));
router.get('/tasks/:taskId',               (req, res) => ctl.getTaskDetail(req, res));
router.patch('/tasks/:taskId/status',      (req, res) => ctl.updateTaskStatus(req, res));
router.post('/tasks/:taskId/retry-assign', (req, res) => ctl.retryAutoAssign(req, res));
router.get('/unprocessed',                 (req, res) => ctl.getUnprocessed(req, res));
router.post('/unprocessed/push',           (req, res) => ctl.pushUnprocessed(req, res));
router.get('/failed-assigns',              (req, res) => ctl.getFailedAssigns(req, res));
router.get('/stats',                       (req, res) => ctl.getStats(req, res));

export default router;
