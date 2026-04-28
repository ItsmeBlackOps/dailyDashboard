import express from 'express';
import { authenticateHTTP } from '../middleware/auth.js';
import { interviewSupportAdminController as ctl } from '../controllers/interviewSupportAdminController.js';

const router = express.Router();

const ALLOWED_EMAIL = 'harsh.patel@silverspaceinc.com';

router.use(authenticateHTTP);
router.use((req, res, next) => {
  const email = (req.user?.email || '').trim().toLowerCase();
  if (email !== ALLOWED_EMAIL) {
    return res.status(403).json({ success: false, error: 'access denied' });
  }
  next();
});

router.get('/tasks',                       (req, res) => ctl.listTasks(req, res));
router.get('/tasks/:taskId',               (req, res) => ctl.getTaskDetail(req, res));
router.patch('/tasks/:taskId/status',      (req, res) => ctl.updateTaskStatus(req, res));
router.post('/tasks/:taskId/retry-assign', (req, res) => ctl.retryAutoAssign(req, res));
router.get('/unprocessed',                 (req, res) => ctl.getUnprocessed(req, res));
router.post('/unprocessed/push',           (req, res) => ctl.pushUnprocessed(req, res));
router.get('/failed-assigns',              (req, res) => ctl.getFailedAssigns(req, res));
router.get('/stats',                       (req, res) => ctl.getStats(req, res));

// Aliases used by the current frontend bundle (kept for back-compat — same handlers)
router.post('/scan-outlook', (req, res) => ctl.getUnprocessed(req, res));
router.post('/push-kafka',   (req, res) => ctl.pushUnprocessed(req, res));
router.get('/logs',          (req, res) => ctl.getStats(req, res));

export default router;
