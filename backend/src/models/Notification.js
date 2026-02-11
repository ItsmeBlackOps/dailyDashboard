import { database } from '../config/database.js';
import { ObjectId } from 'mongodb';

const COLLECTION = 'notifications';

/*
Notification Schema Idea:
{
  recipient: String (email),
  type: String ('info', 'alert', 'success', 'warning'),
  title: String,
  description: String,
  link: String (optional),
  isRead: Boolean,
  candidateId: ObjectId (optional),
  createdAt: Date,
  expiresAt: Date (TTL index field)
}
*/

class NotificationModel {
    async initialize() {
        const db = database.getDatabase();
        const collection = db.collection(COLLECTION);

        // Create TTL index on expiresAt (7 days usually set in logic, but here we can just index it to expire when date is reached)
        // MongoDB TTL expires documents *after* the specified time in the field if the index is created with expireAfterSeconds: 0
        await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

        // Create index for fetching by recipient
        await collection.createIndex({ recipient: 1, createdAt: -1 });

        // Create unique index to prevent duplicate notifications for same event
        await collection.createIndex({ recipient: 1, eventId: 1 }, { unique: true, sparse: true });
    }

    async createNotification(data) {
        const collection = database.getCollection(COLLECTION);

        // Default expiration: 7 days from now
        const now = new Date();
        const expiresAt = new Date(now);
        expiresAt.setDate(expiresAt.getDate() + 7);

        const notification = {
            recipient: data.recipient, // Email
            type: data.type || 'info',
            title: data.title,
            description: data.description,
            link: data.link || null,
            isRead: false,
            candidateId: data.candidateId ? new ObjectId(data.candidateId) : null,
            eventId: data.eventId || null, // Ensure eventId is stored
            createdAt: now,
            expiresAt: data.expiresAt || expiresAt,
            batchData: data.batchData || null,
            changeDetails: data.changeDetails || null,
            actor: data.actor || null
        };

        // Use updateOne with upsert to prevent duplicates
        // If (recipient + eventId) exists, do nothing (or update if needed, but here we just want to ensure existance)
        // actually, if it exists we might want to keep the old one or overwrite. 
        // User requested: "First insert succeeds, Second insert does nothing".
        // So $setOnInsert is correct for all fields.

        const filter = {
            recipient: data.recipient,
            eventId: data.eventId
        };

        // If eventId is missing, we fall back to standard insert behavior (or generate one?)
        // For now, if no eventId, we can't dedup by eventId. 
        // We will assume eventId is passed. If not, maybe use a random fallback or just insert.

        if (!data.eventId) {
            const result = await collection.insertOne(notification);
            return { ...notification, id: result.insertedId };
        }

        const result = await collection.updateOne(
            filter,
            { $setOnInsert: notification },
            { upsert: true }
        );

        // If upserted, result.upsertedId is the new ID.
        // If matched (duplicate), result.upsertedId is null.
        // We need to return the doc. If duplicate, we might need to fetch it or just return the passed object with a placeholder ID?
        // The original method returned { ...notification, id: result.insertedId }.
        // Let's try to return the ID.

        return {
            ...notification,
            id: result.upsertedId || null // null implies it was a duplicate and we didn't create a new one
        };
    }

    async createManyNotifications(notifications) {
        const collection = database.getCollection(COLLECTION);
        if (!notifications.length) return [];

        const now = new Date();
        const expiresAt = new Date(now);
        expiresAt.setDate(expiresAt.getDate() + 7);

        const docs = notifications.map(n => ({
            recipient: n.recipient,
            type: n.type || 'info',
            title: n.title,
            description: n.description,
            link: n.link || null,
            isRead: false,
            candidateId: n.candidateId ? new ObjectId(n.candidateId) : null,
            createdAt: now,
            expiresAt: expiresAt,
            batchData: n.batchData || null,
            changeDetails: n.changeDetails || null,
            actor: n.actor || null
        }));

        await collection.insertMany(docs);
        return docs;
    }

    async getNotificationsForUser(email, limit = 50) {
        const collection = database.getCollection(COLLECTION);
        return collection
            .find({ recipient: email })
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();
    }

    async markAsRead(notificationId, userEmail) {
        const collection = database.getCollection(COLLECTION);
        await collection.updateOne(
            { _id: new ObjectId(notificationId), recipient: userEmail },
            { $set: { isRead: true } }
        );
    }

    async markAllAsRead(userEmail) {
        const collection = database.getCollection(COLLECTION);
        await collection.updateMany(
            { recipient: userEmail, isRead: false },
            { $set: { isRead: true } }
        );
    }
}

export const notificationModel = new NotificationModel();
