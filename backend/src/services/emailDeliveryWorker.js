// PRT Phase 3.5 — durable email delivery worker.
//
// Polls EmailOutboxRepository on a fixed interval, claims pending rows
// one at a time, and dispatches them via graphMailService.sendApplicationMail.
// Modelled on NotificationDeliveryWorker (start/stop/scheduleNextTick).
//
// Why app-only (not delegated)?
//   The outbox can sit pending for hours/days on a Graph outage. The
//   clicker's MSAL access token would have expired long before the
//   retry window closes, so we send from the configured app mailbox
//   (config.azure.mailSender) — the "From" address becomes the app's
//   shared sender. This is a deliberate UX trade-off chosen during
//   Phase 3.5 planning.
//
// Terminal-state side effects (per row):
//   - SENT     → push 'sent'   audit row onto candidate.assignmentEmails[]
//                + $set ackEmail='Sent', ackEmailAt=now
//                + emit CandidateAssignmentEmailSent
//   - FAILED   → push 'failed' audit row + notificationService broadcast
//                to admins. ackEmail is NOT flipped.

import { emailOutboxRepository, STATUS_PENDING, STATUS_SENT, STATUS_FAILED } from './emailOutboxRepository.js';
import { graphMailService } from './graphMailService.js';
import { candidateModel } from '../models/Candidate.js';
import { userModel } from '../models/User.js';
import { notificationService } from './notificationService.js';
import { domainEventBus } from '../events/eventBus.js';
import { DomainEvents } from '../events/eventTypes.js';
import { logger } from '../utils/logger.js';
import crypto from 'node:crypto';

const DEFAULT_POLL_INTERVAL_MS = 60 * 1000;
const DEFAULT_BATCH_SIZE = 10;

function buildAuditEntry(row, status) {
  const base = row.audit || {};
  return {
    ts: new Date(),
    sender: base.sender || row.enqueuedBy,
    to: Array.isArray(base.to) ? base.to : [],
    cc: Array.isArray(base.cc) ? base.cc : [],
    bcc: Array.isArray(base.bcc) ? base.bcc : [],
    subject: base.subject || (row.payload?.message?.subject ?? ''),
    attachmentIds: Array.isArray(base.attachmentIds) ? base.attachmentIds : [],
    attempts: Number(row.attempts || 0),
    status,
    ...(status === STATUS_FAILED && row.lastError ? { lastError: row.lastError } : {})
  };
}

async function pushAssignmentEmailsRow(candidateId, auditEntry, extraSet = {}) {
  try {
    await candidateModel.updateCandidateById(candidateId, {
      _pushAssignmentEmail: auditEntry,
      _changedBy: 'system:emailDeliveryWorker',
      _source: 'assignment-email-worker',
      ...extraSet
    });
  } catch (err) {
    logger.warn('emailDeliveryWorker: failed to push assignmentEmails audit row', {
      candidateId,
      status: auditEntry?.status,
      error: err.message
    });
  }
}

async function notifyAdminsAssignmentFailed(candidateId, row) {
  try {
    const admins = (userModel.getAllUsers() || [])
      .filter((u) => (u?.role || '').toLowerCase() === 'admin' && u?.active !== false)
      .map((u) => u.email)
      .filter(Boolean);
    if (admins.length === 0) return;
    await notificationService.broadcastToWatchers(admins, {
      type: 'assignment-email-failed',
      title: 'Assignment email failed (after retries)',
      description: `Send for candidate ${candidateId} failed permanently. ${row.lastError || ''}`.trim(),
      candidateId,
      actor: { email: row.enqueuedBy || 'system', role: 'system' },
      link: `/candidate/${candidateId}`
    });
  } catch (err) {
    logger.warn('emailDeliveryWorker: admin failure notification threw', {
      candidateId,
      error: err.message
    });
  }
}

export class EmailDeliveryWorker {
  constructor({
    outboxRepository = emailOutboxRepository,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    batchSize = DEFAULT_BATCH_SIZE
  } = {}) {
    this.outboxRepository = outboxRepository;
    this.pollIntervalMs = pollIntervalMs;
    this.batchSize = batchSize;
    this.timer = null;
    this.running = false;
    this.ticking = false;
  }

  start() {
    if (this.running) {
      logger.warn('EmailDeliveryWorker already running — ignoring start');
      return;
    }
    this.running = true;
    this.scheduleNextTick(0);
    logger.info('EmailDeliveryWorker started', {
      pollIntervalMs: this.pollIntervalMs,
      batchSize: this.batchSize
    });
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('EmailDeliveryWorker stopped');
  }

  scheduleNextTick(delayMs = this.pollIntervalMs) {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.tick().catch((err) => {
        logger.error('EmailDeliveryWorker tick threw', { error: err.message });
      }).finally(() => {
        this.scheduleNextTick(this.pollIntervalMs);
      });
    }, delayMs);
  }

  async tick() {
    if (this.ticking) return { claimed: 0, sent: 0, retried: 0, failed: 0 };
    this.ticking = true;
    let counters = { claimed: 0, sent: 0, retried: 0, failed: 0 };
    try {
      const claimed = await this.outboxRepository.claimPendingBatch(this.batchSize);
      counters.claimed = claimed.length;
      for (const row of claimed) {
        const result = await this.processOne(row);
        if (result === 'sent') counters.sent += 1;
        else if (result === 'failed') counters.failed += 1;
        else if (result === 'retry') counters.retried += 1;
      }
    } finally {
      this.ticking = false;
    }
    if (counters.claimed > 0) {
      logger.info('EmailDeliveryWorker tick complete', counters);
    }
    return counters;
  }

  async processOne(row) {
    const { _id, candidateId, payload } = row;
    try {
      const response = await graphMailService.sendApplicationMail(payload);
      const sentRow = await this.outboxRepository.markSent(_id, {
        graphMessageId: response?.id || null
      });
      const auditEntry = buildAuditEntry(sentRow || row, STATUS_SENT);
      await pushAssignmentEmailsRow(candidateId, auditEntry, {
        ackEmail: 'Sent',
        ackEmailAt: new Date()
      });
      domainEventBus.publish(DomainEvents.CandidateAssignmentEmailSent, {
        eventId: crypto.randomUUID(),
        candidateId,
        audit: auditEntry,
        occurredAt: new Date().toISOString(),
        actor: { email: row.enqueuedBy, role: 'system' }
      });
      return 'sent';
    } catch (sendErr) {
      const updated = await this.outboxRepository.markRetryOrFail(_id, sendErr?.message || String(sendErr));
      if (updated && updated.status === STATUS_PENDING) {
        logger.warn('EmailDeliveryWorker: send failed — retry scheduled', {
          outboxId: String(_id),
          candidateId,
          attempts: updated.attempts,
          nextAvailableAt: updated.availableAt,
          error: sendErr?.message
        });
        return 'retry';
      }
      // Permanent failure path.
      const failedRow = updated || { ...row, status: STATUS_FAILED, lastError: sendErr?.message };
      const auditEntry = buildAuditEntry(failedRow, STATUS_FAILED);
      await pushAssignmentEmailsRow(candidateId, auditEntry);
      await notifyAdminsAssignmentFailed(candidateId, failedRow);
      logger.error('EmailDeliveryWorker: send permanently failed', {
        outboxId: String(_id),
        candidateId,
        attempts: failedRow.attempts,
        error: sendErr?.message
      });
      return 'failed';
    }
  }
}

export const emailDeliveryWorker = new EmailDeliveryWorker();
