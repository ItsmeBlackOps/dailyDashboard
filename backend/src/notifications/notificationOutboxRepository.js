import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const COLLECTION_NAME = 'notification_outbox';
const STATUS_PENDING = 'pending';
const STATUS_PROCESSING = 'processing';

export class NotificationOutboxRepository {
  constructor() {
    this.collection = null;
  }

  async initialize() {
    this.collection = database.getCollection(COLLECTION_NAME);
    await this.ensureIndexes();
  }

  async ensureIndexes() {
    try {
      await this.collection.createIndexes([
        {
          key: { status: 1, availableAt: 1, priority: -1 },
          name: 'idx_notification_dispatch_order'
        },
        {
          key: { checksum: 1 },
          name: 'uk_notification_checksum',
          unique: true
        },
        {
          key: { expiresAt: 1 },
          name: 'idx_notification_expiry',
          expireAfterSeconds: 0
        }
      ]);

      logger.info('Notification outbox indexes ensured');
    } catch (error) {
      logger.error('Failed to ensure notification outbox indexes', {
        error: error.message
      });
      throw error;
    }
  }

  async enqueue(notification) {
    const now = new Date();
    const doc = {
      ...notification,
      status: STATUS_PENDING,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      availableAt: notification.availableAt || now
    };

    try {
      const result = await this.collection.updateOne(
        { checksum: doc.checksum },
        { $setOnInsert: doc },
        { upsert: true }
      );

      if (result.upsertedCount === 1) {
        logger.debug('Notification enqueued', {
          checksum: doc.checksum,
          eventType: doc.eventType,
          audienceScope: doc.audienceScope
        });
      } else {
        logger.debug('Notification deduplicated', {
          checksum: doc.checksum,
          eventType: doc.eventType,
          audienceScope: doc.audienceScope
        });
      }
    } catch (error) {
      logger.error('Failed to enqueue notification', {
        error: error.message,
        eventType: doc.eventType,
        audienceScope: doc.audienceScope
      });
      throw error;
    }
  }

  async claimPendingBatch(batchSize) {
    const cursor = this.collection
      .find({
        status: STATUS_PENDING,
        expiresAt: { $gt: new Date() },
        availableAt: { $lte: new Date() }
      })
      .sort({ priority: -1, createdAt: 1 })
      .limit(batchSize);

    const candidates = await cursor.toArray();
    const claimed = [];

    for (const candidate of candidates) {
      const result = await this.collection.updateOne(
        { _id: candidate._id, status: STATUS_PENDING },
        {
          $set: {
            status: STATUS_PROCESSING,
            startedAt: new Date(),
            updatedAt: new Date()
          }
        }
      );

      if (result.modifiedCount === 1) {
        claimed.push({ ...candidate, status: STATUS_PROCESSING });
      }
    }

    return claimed;
  }

  async markDelivered(id, deliveredTo) {
    await this.collection.updateOne(
      { _id: this.toObjectId(id) },
      {
        $set: {
          status: 'delivered',
          deliveredAt: new Date(),
          deliveredTo,
          updatedAt: new Date()
        }
      }
    );
  }

  async markSkipped(id, reason) {
    await this.collection.updateOne(
      { _id: this.toObjectId(id) },
      {
        $set: {
          status: 'skipped',
          skipReason: reason,
          updatedAt: new Date()
        }
      }
    );
  }

  async markFailed(id, errorMessage, maxAttempts, backoffMs) {
    const objectId = this.toObjectId(id);
    const record = await this.collection.findOne({ _id: objectId }, { projection: { attempts: 1 } });

    if (!record) {
      return null;
    }

    const attempts = Number(record.attempts || 0) + 1;
    const nextAttempt = new Date(Date.now() + Math.max(backoffMs, 1000));
    const hasAttemptsLeft = attempts < maxAttempts;

    const update = {
      $set: {
        attempts,
        lastError: errorMessage,
        updatedAt: new Date(),
        status: hasAttemptsLeft ? STATUS_PENDING : 'failed'
      }
    };

    if (hasAttemptsLeft) {
      update.$set.availableAt = nextAttempt;
    }

    await this.collection.updateOne({ _id: objectId }, update);

    return {
      ...record,
      attempts,
      status: update.$set.status,
      availableAt: update.$set.availableAt
    };
  }

  async purgeByCandidate(candidateId) {
    if (!candidateId) return;
    await this.collection.deleteMany({
      'payload.candidateId': String(candidateId)
    });
  }

  toObjectId(id) {
    if (id instanceof ObjectId) {
      return id;
    }
    return new ObjectId(id);
  }
}
