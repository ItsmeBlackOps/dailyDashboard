import express from 'express';
import { getNotifications, markAsRead, markAllAsRead } from '../controllers/notificationController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

router.get('/', getNotifications);
router.put('/:id/read', markAsRead);
router.put('/read-all', markAllAsRead);

export default router;
