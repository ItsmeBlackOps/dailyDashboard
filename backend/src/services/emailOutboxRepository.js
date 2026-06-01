// PRT Phase 3.5 — durable outbox for assignment emails (and any future
// candidate-side outbound mail). Modelled on NotificationOutboxRepository.
//
// Lifecycle: pending -> sending -> (sent | failed)
//   - enqueue() writes status=pending with availableAt=now.
//   - claimPendingBatch() atomically flips pending -> sending.
//   - markSent() terminal success.
//   - markRetryOrFail() either reschedules (status -> pending with the
//     next backoff availableAt) or terminates with status=failed when
//     the max-attempt or 24h budget is exhausted.
//
// Worker calls these from emailDeliveryWorker.js; nothing else writes
// the collection directly.

import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const COLLECTION = 'emailOutbox';
export const STATUS_PENDING = 'pending';
export const STATUS_SENDING = 'sending';
export const STATUS_SENT = 'sent';
export const STATUS_FAILED = 'failed';

// Exponential backoff (ms) for transient Graph failures. Includes the
// initial attempt (delay 0) followed by 5 retries — 6 attempts total
// over ~7.5h, hard-capped at the 24h expiresAt envelope.
export const DEFAULT_BACKOFF_SCHEDULE_MS = [
  0,             // attempt 1 — immediate
  60 * 1000,     // attempt 2 — 1m
  5 * 60 * 1000, // attempt 3 — 5m
  15 * 60 * 1000,// attempt 4 — 15m
  60 * 60 * 1000,// attempt 5 — 1h
  6 * 60 * 60 * 1000 // attempt 6 — 6h
];
export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h budget

export class EmailOutboxRepository {
  constructor(collectionName = COLLECTION) {
    this.collectionName = collectionName;
    this.collection = null;
  }

  async initialize() {
    const db = database.getDb();
    if (!db) throw new Error('Database not initialised — cannot init EmailOutboxRepository');
    this.collection = db.collection(this.collectionName);
    await this.ensureIndexes();
  }

  async ensureIndexes() {
    if (!this.collection) return;
    // claim-batch hot path: pending + availableAt <= now ordered by FIFO.
    await this.collection.createIndex({ status: 1, availableAt: 1 });
    // candidate-side audit queries.
    await this.collection.createIndex({ candidateId: 1, enqueuedAt: -1 });
    // Janitorial / TTL-style sweep for terminal rows older than 7 days.
    await this.collection.createIndex({ status: 1, updatedAt: 1 });
  }

  // payload = { message: <Graph>, saveToSentItems: bool }
  // audit  = { sender, to[], cc[], bcc[], subject, attachmentIds[] }
  async enqueue({ type = 'assignmentEmail', candidateId, payload, audit, enqueuedBy, maxAgeMs }) {
    if (!this.collection) throw new Error('EmailOutboxRepository not initialised');
    if (!candidateId) throw new Error('candidateId is required');
    if (!payload || !payload.message) throw new Error('payload.message is required');
    if (!enqueuedBy) throw new Error('enqueuedBy is required');

    const now = new Date();
    const expires = new Date(now.getTime() + (maxAgeMs || DEFAULT_MAX_AGE_MS));
    const doc = {
      type,
      candidateId: String(candidateId),
      payload,
      audit: audit || null,
      status: STATUS_PENDING,
      attempts: 0,
      maxAttempts: DEFAULT_BACKOFF_SCHEDULE_MS.length,
      enqueuedBy,
      enqueuedAt: now,
      availableAt: now,
      expiresAt: expires,
      startedAt: null,
      sentAt: null,
      failedAt: null,
      lastError: null,
      updatedAt: now
    };
    const result = await this.collection.insertOne(doc);
    return { ...doc, _id: result.insertedId };
  }

  // Atomic flip pending -> sending. One row at a time so a slow Graph
  // call on row A never starves rows B/C. Caller iterates.
  async claimPendingBatch(batchSize = 10) {
    if (!this.collection) return [];
    const claimed = [];
    const now = new Date();
    for (let i = 0; i < batchSize; i++) {
      const result = await this.collection.findOneAndUpdate(
        {
          status: STATUS_PENDING,
          availableAt: { $lte: now },
          expiresAt: { $gt: now }
        },
        {
          $set: {
            status: STATUS_SENDING,
            startedAt: now,
            updatedAt: now
          }
        },
        { sort: { availableAt: 1 }, returnDocument: 'after' }
      );
      const doc = result?.value ?? result; // driver compatibility
      if (!doc || !doc._id) break;
      claimed.push(doc);
    }
    // Also sweep any row stuck in sending past its expiresAt — that means
    // the previous worker died mid-send. Mark them failed.
    await this.collection.updateMany(
      { status: STATUS_SENDING, expiresAt: { $lte: now } },
      {
        $set: {
          status: STATUS_FAILED,
          failedAt: now,
          updatedAt: now,
          lastError: 'expired_in_sending_state'
        }
      }
    );
    return claimed;
  }

  async markSent(id, meta = {}) {
    if (!this.collection) return null;
    const now = new Date();
    const result = await this.collection.findOneAndUpdate(
      { _id: this.toObjectId(id) },
      {
        $set: {
          status: STATUS_SENT,
          sentAt: now,
          updatedAt: now,
          lastError: null,
          ...(meta.graphMessageId ? { graphMessageId: meta.graphMessageId } : {})
        }
      },
      { returnDocument: 'after' }
    );
    return result?.value ?? result ?? null;
  }

  // Returns the updated row so the worker can decide whether it just
  // moved to STATUS_PENDING (retry queued) or STATUS_FAILED (permanent).
  async markRetryOrFail(id, errorMessage, options = {}) {
    if (!this.collection) return null;
    const objectId = this.toObjectId(id);
    const record = await this.collection.findOne(
      { _id: objectId },
      { projection: { attempts: 1, expiresAt: 1, maxAttempts: 1 } }
    );
    if (!record) return null;

    const now = new Date();
    const attempts = Number(record.attempts || 0) + 1;
    const schedule = options.backoffScheduleMs || DEFAULT_BACKOFF_SCHEDULE_MS;
    const maxAttempts = record.maxAttempts || schedule.length;
    const hasAttemptsLeft = attempts < maxAttempts;
    const withinBudget = record.expiresAt && record.expiresAt.getTime() > now.getTime();
    const shouldRetry = hasAttemptsLeft && withinBudget;

    let nextAvailableAt = null;
    if (shouldRetry) {
      // backoff at INDEX = attempts (because we just finished attempt
      // number `attempts`, the next one waits the corresponding slot).
      const delayMs = schedule[Math.min(attempts, schedule.length - 1)] ?? 0;
      // Clamp to within expiresAt so we don't wait past the budget.
      const wantedAt = now.getTime() + delayMs;
      const expiresMs = record.expiresAt.getTime();
      nextAvailableAt = new Date(Math.min(wantedAt, expiresMs - 1));
    }

    const update = {
      $set: {
        attempts,
        lastError: (errorMessage || '').slice(0, 1000),
        updatedAt: now,
        status: shouldRetry ? STATUS_PENDING : STATUS_FAILED,
        ...(shouldRetry ? { availableAt: nextAvailableAt } : { failedAt: now })
      }
    };

    const result = await this.collection.findOneAndUpdate(
      { _id: objectId },
      update,
      { returnDocument: 'after' }
    );
    return result?.value ?? result ?? null;
  }

  async findById(id) {
    if (!this.collection) return null;
    return this.collection.findOne({ _id: this.toObjectId(id) });
  }

  toObjectId(id) {
    if (id instanceof ObjectId) return id;
    try {
      return new ObjectId(id);
    } catch {
      throw new Error(`Invalid outbox id: ${id}`);
    }
  }
}

export const emailOutboxRepository = new EmailOutboxRepository();
