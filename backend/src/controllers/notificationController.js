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

export const recordPopupView = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await notificationService.recordPopupView(req.user, id);
        res.json({ success: true, ...result });
    } catch (error) {
        next(error);
    }
};

export const sendAnnouncement = async (req, res, next) => {
    try {
        const { audience, title, description, link, popup, actor, expiresInDays } = req.body || {};
        const result = await notificationService.sendAnnouncement({ audience, title, description, link, popup, actor, expiresInDays });
        res.json({ success: true, ...result });
    } catch (error) {
        if (error.statusCode === 400) {
            return res.status(400).json({ success: false, error: error.message });
        }
        next(error);
    }
};
