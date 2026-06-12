import express from 'express';
import { getNotifications, markAsRead, markAllAsRead, recordPopupView, sendAnnouncement } from '../controllers/notificationController.js';
import { authenticateHTTP, requireHTTPRole } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateHTTP);

router.get('/', getNotifications);
router.put('/:id/read', markAsRead);
router.put('/:id/popup-seen', recordPopupView);
router.put('/read-all', markAllAsRead);
// Admin: fan an announcement out to an audience (optionally as a pop-up).
router.post('/announce', requireHTTPRole(['admin']), sendAnnouncement);

export default router;
