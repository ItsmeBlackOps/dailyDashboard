import { notificationModel } from '../models/Notification.js';
import { logger } from '../utils/logger.js';

class NotificationService {
    async createNotification(recipient, payload) {
        try {
            if (!recipient) return null;
            return await notificationModel.createNotification({
                recipient: recipient.toLowerCase(),
                ...payload
            });
        } catch (error) {
            logger.error('Failed to create notification', { error, recipient });
            return null;
        }
    }

    async broadcastToWatchers(watchers, payload) {
        if (!watchers || watchers.length === 0) return;

        // Filter valid emails
        const recipients = [...new Set(watchers.filter(e => e && e.includes('@')))];

        // Prepare documents
        const notifications = recipients.map(email => ({
            recipient: email.toLowerCase(),
            ...payload
        }));

        try {
            await notificationModel.createManyNotifications(notifications);
            return recipients;
        } catch (error) {
            logger.error('Failed to broadcast notifications', { error, count: recipients.length });
            return [];
        }
    }

    async getUserNotifications(user) {
        if (!user?.email) return [];
        const raw = await notificationModel.getNotificationsForUser(user.email.toLowerCase());
        return raw.map(n => ({
            id: n._id,
            type: n.type,
            title: n.title,
            description: n.description,
            timestamp: n.createdAt,
            read: n.isRead,
            candidateId: n.candidateId,
            link: n.link,
            batchData: n.batchData,
            changeDetails: n.changeDetails,
            actor: n.actor
        }));
    }

    async markAsRead(user, notificationId) {
        if (!user?.email || !notificationId) return;
        await notificationModel.markAsRead(notificationId, user.email.toLowerCase());
    }

    async markAllAsRead(user) {
        if (!user?.email) return;
        await notificationModel.markAllAsRead(user.email.toLowerCase());
    }
}

export const notificationService = new NotificationService();
