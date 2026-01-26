import { notificationService } from '../services/notificationService.js';

export const getNotifications = async (req, res, next) => {
    try {
        const notifications = await notificationService.getUserNotifications(req.user);
        res.json({ success: true, notifications });
    } catch (error) {
        next(error);
    }
};

export const markAsRead = async (req, res, next) => {
    try {
        const { id } = req.params;
        await notificationService.markAsRead(req.user, id);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

export const markAllAsRead = async (req, res, next) => {
    try {
        await notificationService.markAllAsRead(req.user);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
};
