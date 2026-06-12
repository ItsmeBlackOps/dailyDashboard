import { notificationModel } from '../models/Notification.js';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const POPUP_VIEW_CAP = 3;

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
            actor: n.actor,
            popup: n.popup === true,
            popupViews: n.popupViews || 0
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

    // Records a pop-up viewing; once the cap is reached we also mark the
    // notification read so it leaves the unread bell count too.
    async recordPopupView(user, notificationId) {
        if (!user?.email || !notificationId) return { views: 0, capped: false };
        const views = await notificationModel.incrementPopupViews(notificationId, user.email.toLowerCase());
        if (views >= POPUP_VIEW_CAP) {
            await notificationModel.markAsRead(notificationId, user.email.toLowerCase());
        }
        return { views, capped: views >= POPUP_VIEW_CAP };
    }

    // Admin: fan an announcement out to an audience. `audience` is 'all' |
    // 'technical' | 'marketing'. Each send is a fresh announcement (unique
    // eventId), optionally flagged `popup`.
    async sendAnnouncement({ audience = 'all', title, description, link, popup, actor, expiresInDays = 30 }) {
        if (!title || !description) {
            const err = new Error('title and description are required');
            err.statusCode = 400;
            throw err;
        }
        const users = database.getCollection('users');
        const base = { active: { $ne: false } };
        let filter = base;
        if (audience === 'technical') {
            filter = { ...base, $or: [{ team: 'technical' }, { role: { $in: ['user', 'expert', 'lead', 'am'] } }] };
        } else if (audience === 'marketing') {
            filter = { ...base, $or: [{ team: 'marketing' }, { role: { $in: ['mm', 'mam', 'mlead', 'recruiter', 'manager'] } }] };
        }
        const recipients = await users.find(filter, { projection: { email: 1 } }).toArray();
        const emails = [...new Set(recipients.map((u) => (u.email || '').toLowerCase()).filter((e) => e.includes('@')))];

        const eventId = `announce-${Date.now()}`;
        const expiresAt = new Date(Date.now() + Math.max(1, expiresInDays) * 24 * 60 * 60 * 1000);
        let created = 0;
        for (const email of emails) {
            const res = await notificationModel.createNotification({
                recipient: email,
                type: 'info',
                title,
                description,
                link: link || null,
                actor: actor || null,
                popup: popup === true,
                eventId,
                expiresAt,
            });
            if (res && res.id) created += 1;
        }
        logger.info('Announcement sent', { audience, recipients: emails.length, created, popup: popup === true, eventId });
        return { audience, recipients: emails.length, created, eventId };
    }
}

export const notificationService = new NotificationService();
