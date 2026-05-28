import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ObjectId } from 'mongodb';
import {
  EmailDeliveryWorker
} from '../src/services/emailDeliveryWorker.js';
import {
  STATUS_PENDING,
  STATUS_SENT,
  STATUS_FAILED
} from '../src/services/emailOutboxRepository.js';
import { graphMailService } from '../src/services/graphMailService.js';
import { candidateModel } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';
import { notificationService } from '../src/services/notificationService.js';
import { domainEventBus } from '../src/events/eventBus.js';
import { DomainEvents } from '../src/events/eventTypes.js';

const originalSendApplicationMail = graphMailService.sendApplicationMail;
const originalUpdateCandidateById = candidateModel.updateCandidateById;
const originalGetAllUsers = userModel.getAllUsers;
const originalBroadcastToWatchers = notificationService.broadcastToWatchers;

afterEach(() => {
  graphMailService.sendApplicationMail = originalSendApplicationMail;
  candidateModel.updateCandidateById = originalUpdateCandidateById;
  userModel.getAllUsers = originalGetAllUsers;
  notificationService.broadcastToWatchers = originalBroadcastToWatchers;
  jest.restoreAllMocks();
});

function makeRow(overrides = {}) {
  return {
    _id: new ObjectId(),
    type: 'assignmentEmail',
    candidateId: 'cand-1',
    payload: {
      message: {
        subject: 'Assignment: X',
        body: { contentType: 'HTML', content: '<p>hi</p>' },
        toRecipients: [{ emailAddress: { address: 'rec@co.com' } }],
        ccRecipients: [{ emailAddress: { address: 'lead@co.com' } }],
        bccRecipients: [],
        attachments: []
      },
      saveToSentItems: false
    },
    audit: {
      sender: 'mm@co.com',
      to: ['rec@co.com'],
      cc: ['lead@co.com'],
      bcc: [],
      subject: 'Assignment: X',
      attachmentIds: ['att-1']
    },
    status: 'sending',
    attempts: 0,
    maxAttempts: 6,
    enqueuedBy: 'mm@co.com',
    enqueuedAt: new Date(),
    availableAt: new Date(),
    startedAt: new Date(),
    sentAt: null,
    failedAt: null,
    lastError: null,
    ...overrides
  };
}

function mockRepoSuccess() {
  return {
    claimPendingBatch: jest.fn().mockResolvedValue([]),
    markSent: jest.fn().mockImplementation(async (id) => ({
      _id: id,
      status: STATUS_SENT,
      sentAt: new Date(),
      audit: { sender: 'mm@co.com', to: ['rec@co.com'], cc: ['lead@co.com'], bcc: [], subject: 's', attachmentIds: ['att-1'] },
      attempts: 1
    })),
    markRetryOrFail: jest.fn()
  };
}

function mockRepoRetry() {
  return {
    claimPendingBatch: jest.fn().mockResolvedValue([]),
    markSent: jest.fn(),
    markRetryOrFail: jest.fn().mockImplementation(async (_id, errorMessage) => ({
      _id,
      status: STATUS_PENDING,
      attempts: 1,
      lastError: errorMessage,
      availableAt: new Date(Date.now() + 60_000)
    }))
  };
}

function mockRepoPermanentFail() {
  return {
    claimPendingBatch: jest.fn().mockResolvedValue([]),
    markSent: jest.fn(),
    markRetryOrFail: jest.fn().mockImplementation(async (_id, errorMessage) => ({
      _id,
      status: STATUS_FAILED,
      attempts: 6,
      lastError: errorMessage,
      audit: { sender: 'mm@co.com', to: ['rec@co.com'], cc: ['lead@co.com'], bcc: [], subject: 's', attachmentIds: ['att-1'] }
    }))
  };
}

describe('EmailDeliveryWorker.processOne — success path', () => {
  it('sends, marks sent, pushes audit row, flips ackEmail, emits CandidateAssignmentEmailSent', async () => {
    graphMailService.sendApplicationMail = jest.fn().mockResolvedValue({ id: 'graph-msg-1' });
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({});
    notificationService.broadcastToWatchers = jest.fn().mockResolvedValue([]);
    jest.spyOn(domainEventBus, 'publish').mockImplementation(() => {});

    const repo = mockRepoSuccess();
    const worker = new EmailDeliveryWorker({ outboxRepository: repo });
    const row = makeRow();

    const result = await worker.processOne(row);
    expect(result).toBe('sent');
    expect(graphMailService.sendApplicationMail).toHaveBeenCalledTimes(1);
    expect(repo.markSent).toHaveBeenCalledWith(row._id, { graphMessageId: 'graph-msg-1' });
    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith(
      'cand-1',
      expect.objectContaining({
        _pushAssignmentEmail: expect.objectContaining({ status: STATUS_SENT }),
        ackEmail: 'Sent',
        ackEmailAt: expect.any(Date)
      })
    );
    expect(domainEventBus.publish).toHaveBeenCalledWith(
      DomainEvents.CandidateAssignmentEmailSent,
      expect.objectContaining({ candidateId: 'cand-1' })
    );
  });
});

describe('EmailDeliveryWorker.processOne — transient retry path', () => {
  it('on transient send error: returns "retry"; does NOT push audit or flip ackEmail', async () => {
    graphMailService.sendApplicationMail = jest.fn().mockRejectedValue(
      Object.assign(new Error('Graph 503'), { statusCode: 503 })
    );
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({});
    notificationService.broadcastToWatchers = jest.fn();
    jest.spyOn(domainEventBus, 'publish').mockImplementation(() => {});

    const repo = mockRepoRetry();
    const worker = new EmailDeliveryWorker({ outboxRepository: repo });
    const row = makeRow();

    const result = await worker.processOne(row);
    expect(result).toBe('retry');
    expect(repo.markRetryOrFail).toHaveBeenCalledWith(row._id, expect.stringContaining('Graph 503'));
    expect(candidateModel.updateCandidateById).not.toHaveBeenCalled();
    expect(notificationService.broadcastToWatchers).not.toHaveBeenCalled();
    expect(domainEventBus.publish).not.toHaveBeenCalled();
  });
});

describe('EmailDeliveryWorker.processOne — permanent failure path', () => {
  it('on terminal failure: returns "failed"; pushes failed audit row; notifies admins', async () => {
    graphMailService.sendApplicationMail = jest.fn().mockRejectedValue(
      new Error('Graph hard-fail')
    );
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({});
    notificationService.broadcastToWatchers = jest.fn().mockResolvedValue([]);
    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'admin1@co.com', role: 'admin', active: true },
      { email: 'admin2@co.com', role: 'admin', active: false } // skipped
    ]);
    jest.spyOn(domainEventBus, 'publish').mockImplementation(() => {});

    const repo = mockRepoPermanentFail();
    const worker = new EmailDeliveryWorker({ outboxRepository: repo });
    const row = makeRow();

    const result = await worker.processOne(row);
    expect(result).toBe('failed');
    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith(
      'cand-1',
      expect.objectContaining({
        _pushAssignmentEmail: expect.objectContaining({ status: STATUS_FAILED })
      })
    );
    // ackEmail NOT flipped on failure
    const callArg = candidateModel.updateCandidateById.mock.calls[0][1];
    expect(callArg.ackEmail).toBeUndefined();

    expect(notificationService.broadcastToWatchers).toHaveBeenCalledTimes(1);
    const [recipients, payload] = notificationService.broadcastToWatchers.mock.calls[0];
    expect(recipients).toContain('admin1@co.com');
    expect(recipients).not.toContain('admin2@co.com');
    expect(payload.type).toBe('assignment-email-failed');
  });
});

describe('EmailDeliveryWorker.tick — batch processing', () => {
  it('iterates claimed rows and tallies sent/retried/failed counters', async () => {
    const row1 = makeRow({ candidateId: 'cand-A' });
    const row2 = makeRow({ candidateId: 'cand-B' });
    const row3 = makeRow({ candidateId: 'cand-C' });

    const repo = {
      claimPendingBatch: jest.fn().mockResolvedValue([row1, row2, row3]),
      markSent: jest.fn().mockImplementation(async (id) => ({ _id: id, status: STATUS_SENT, audit: row1.audit, attempts: 1 })),
      markRetryOrFail: jest.fn().mockImplementation(async (_id) => ({ _id, status: STATUS_PENDING, attempts: 1, audit: row1.audit }))
    };
    graphMailService.sendApplicationMail = jest.fn()
      .mockResolvedValueOnce({ id: 'g1' })                        // row1 sent
      .mockRejectedValueOnce(Object.assign(new Error('transient'), { statusCode: 503 })) // row2 retry
      .mockResolvedValueOnce({ id: 'g3' });                       // row3 sent
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({});
    jest.spyOn(domainEventBus, 'publish').mockImplementation(() => {});

    const worker = new EmailDeliveryWorker({ outboxRepository: repo });
    const counters = await worker.tick();
    expect(counters).toEqual({ claimed: 3, sent: 2, retried: 1, failed: 0 });
  });

  it('returns zero counters when no rows are claimed', async () => {
    const repo = mockRepoSuccess();
    const worker = new EmailDeliveryWorker({ outboxRepository: repo });
    const counters = await worker.tick();
    expect(counters).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0 });
  });
});

describe('EmailDeliveryWorker lifecycle', () => {
  it('start/stop is idempotent and clears the timer cleanly', () => {
    const repo = mockRepoSuccess();
    const worker = new EmailDeliveryWorker({
      outboxRepository: repo,
      pollIntervalMs: 1_000_000 // big so nothing fires during the test
    });
    worker.start();
    expect(worker.running).toBe(true);
    worker.start(); // ignored
    expect(worker.running).toBe(true);
    worker.stop();
    expect(worker.running).toBe(false);
    worker.stop(); // safe to call twice
    expect(worker.running).toBe(false);
  });
});
