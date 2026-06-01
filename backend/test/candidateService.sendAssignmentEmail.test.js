import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { candidateModel } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';
import { userService } from '../src/services/userService.js';
import { storageService } from '../src/services/storageService.js';
import { emailOutboxRepository } from '../src/services/emailOutboxRepository.js';

// Phase 3.5 — the service no longer sends mail itself; it builds the
// Graph payload, validates the gates, and enqueues a row in the
// EmailOutbox. The worker (covered in emailDeliveryWorker.test.js)
// handles dispatch + retry + audit. These tests verify the enqueue
// shape and the unchanged gate behaviour.

const originalGetCandidateById = candidateModel.getCandidateById;
const originalUpdateCandidateById = candidateModel.updateCandidateById;
const originalGetUserByEmail = userModel.getUserByEmail;
const originalGetAllUsers = userModel.getAllUsers;
const originalCollectManageableUsers = userService.collectManageableUsers;
const originalFetchObjectAsBase64 = storageService.fetchObjectAsBase64;
const originalEnqueue = emailOutboxRepository.enqueue;

afterEach(() => {
  candidateModel.getCandidateById = originalGetCandidateById;
  candidateModel.updateCandidateById = originalUpdateCandidateById;
  userModel.getUserByEmail = originalGetUserByEmail;
  userModel.getAllUsers = originalGetAllUsers;
  userService.collectManageableUsers = originalCollectManageableUsers;
  storageService.fetchObjectAsBase64 = originalFetchObjectAsBase64;
  emailOutboxRepository.enqueue = originalEnqueue;
  jest.restoreAllMocks();
});

function setupHappyPath(overrides = {}) {
  const candidate = {
    _id: 'cand1',
    'Candidate Name': 'Jane Doe',
    Recruiter: 'recruit.one@company.com',
    recruiter: 'recruit.one@company.com',
    Technology: 'Software Developer',
    technology: 'Software Developer',
    visaType: 'OPT',
    teamLead: 'lead.one@company.com',
    attachments: [{
      id: 'att-1',
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      s3Key: 'attachments/cand1/r.pdf',
      url: 'https://cdn.example.com/r.pdf',
      size: 1234,
      uploadedAt: new Date(),
      uploadedBy: 'recruit.one@company.com'
    }],
    ...overrides
  };
  candidateModel.getCandidateById = jest.fn().mockResolvedValue(candidate);
  candidateModel.updateCandidateById = jest.fn().mockResolvedValue({ ...candidate });
  userService.collectManageableUsers = jest.fn().mockReturnValue([
    { email: 'recruit.one@company.com', role: 'recruiter', active: true }
  ]);
  userModel.getUserByEmail = jest.fn((email) => {
    const e = (email || '').toLowerCase();
    if (e === 'recruit.one@company.com') {
      return {
        email: 'recruit.one@company.com',
        role: 'recruiter',
        active: true,
        manager: 'Tushar Ahuja',
        teamLead: 'Lead One'
      };
    }
    if (e === 'lead.one@company.com') {
      return { email: 'lead.one@company.com', role: 'lead', active: true };
    }
    if (e === 'tushar.ahuja@silverspaceinc.com') {
      return { email: 'tushar.ahuja@silverspaceinc.com', role: 'manager', team: 'marketing', active: true };
    }
    return null;
  });
  userModel.getAllUsers = jest.fn().mockReturnValue([
    { email: 'tushar.ahuja@silverspaceinc.com', role: 'manager', team: 'marketing', active: true }
  ]);
  storageService.fetchObjectAsBase64 = jest.fn().mockResolvedValue({
    base64: 'cGRm',
    contentType: 'application/pdf',
    contentLength: 3
  });
  emailOutboxRepository.enqueue = jest
    .fn()
    .mockImplementation(async ({ candidateId, payload, audit, enqueuedBy }) => ({
      _id: 'outbox-1',
      candidateId,
      payload,
      audit,
      enqueuedBy,
      status: 'pending',
      attempts: 0,
      enqueuedAt: new Date()
    }));
  return candidate;
}

describe('candidateService.sendAssignmentEmail — enqueue-mode happy path', () => {
  it('enqueues an EmailOutbox row and returns { status: "queued", outboxId }', async () => {
    setupHappyPath();
    const result = await candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      null,
      'cand1',
      {}
    );
    expect(result.success).toBe(true);
    expect(result.status).toBe('queued');
    expect(result.outboxId).toBe('outbox-1');
    expect(emailOutboxRepository.enqueue).toHaveBeenCalledTimes(1);
    // No sync mail/ackEmail/audit-push at enqueue time.
    expect(candidateModel.updateCandidateById).not.toHaveBeenCalled();
  });

  it('enqueued payload carries the verbatim §6.2 body + tokens replaced', async () => {
    setupHappyPath();
    await candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      null,
      'cand1',
      {}
    );
    const args = emailOutboxRepository.enqueue.mock.calls[0][0];
    expect(args.payload.message.subject).toBe('Assignment: Jane Doe – Software Developer – OPT');
    const html = args.payload.message.body.content;
    expect(html).toContain('Hi Lead One,');
    expect(html).toContain('to Recruit One');
    expect(html).toMatch(/MM User<\/p>$/);
  });

  it('always injects the configured permanent CC into the enqueued payload, even without a manager', async () => {
    setupHappyPath();
    userModel.getUserByEmail = jest.fn((email) => {
      if ((email || '').toLowerCase() === 'recruit.one@company.com') {
        return { email: 'recruit.one@company.com', role: 'recruiter', active: true };
      }
      if ((email || '').toLowerCase() === 'lead.one@company.com') {
        return { email: 'lead.one@company.com', role: 'lead', active: true };
      }
      return null;
    });
    await candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      null,
      'cand1',
      {}
    );
    const args = emailOutboxRepository.enqueue.mock.calls[0][0];
    const ccs = args.payload.message.ccRecipients.map((r) => r.emailAddress.address);
    expect(ccs).toContain('tushar.ahuja@silverspaceinc.com');
  });

  it('honours an explicit attachmentIds selection', async () => {
    setupHappyPath({
      attachments: [
        { id: 'att-1', filename: 'r.pdf', mimeType: 'application/pdf', s3Key: 'r.pdf', url: 'u1', size: 1, uploadedAt: new Date(), uploadedBy: 'x' },
        { id: 'att-2', filename: 'cred.pdf', mimeType: 'application/pdf', s3Key: 'c.pdf', url: 'u2', size: 1, uploadedAt: new Date(), uploadedBy: 'x' }
      ]
    });
    await candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      null,
      'cand1',
      { attachmentIds: ['att-2'] }
    );
    expect(storageService.fetchObjectAsBase64).toHaveBeenCalledTimes(1);
    const args = emailOutboxRepository.enqueue.mock.calls[0][0];
    expect(args.payload.message.attachments).toHaveLength(1);
    expect(args.payload.message.attachments[0].name).toBe('cred.pdf');
  });

  it('respects a subject override from the modal', async () => {
    setupHappyPath();
    await candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      null,
      'cand1',
      { subject: 'Custom Subject — urgent' }
    );
    const args = emailOutboxRepository.enqueue.mock.calls[0][0];
    expect(args.payload.message.subject).toBe('Custom Subject — urgent');
    expect(args.audit.subject).toBe('Custom Subject — urgent');
  });
});

describe('candidateService.sendAssignmentEmail — gates (unchanged)', () => {
  it('401 if user is missing role', async () => {
    setupHappyPath();
    await expect(candidateService.sendAssignmentEmail(
      { email: 'x@y' },
      null,
      'cand1',
      {}
    )).rejects.toMatchObject({ statusCode: 401 });
  });

  it('403 for technical roles (lead / am / expert / user)', async () => {
    setupHappyPath();
    for (const role of ['lead', 'am', 'expert', 'user']) {
      await expect(candidateService.sendAssignmentEmail(
        { email: `${role}@company.com`, role },
        null,
        'cand1',
        {}
      )).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('400 if candidate has no Team Lead', async () => {
    setupHappyPath({ teamLead: '' });
    await expect(candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM' },
      null,
      'cand1',
      {}
    )).rejects.toMatchObject({ statusCode: 400 });
  });

  it('400 if candidate has no attachments', async () => {
    setupHappyPath({ attachments: [] });
    await expect(candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM' },
      null,
      'cand1',
      {}
    )).rejects.toMatchObject({ statusCode: 400 });
  });

  it('403 when the candidate recruiter is out of the actor\'s scope', async () => {
    setupHappyPath();
    userService.collectManageableUsers = jest.fn().mockReturnValue([]);
    await expect(candidateService.sendAssignmentEmail(
      { email: 'rec.outside@company.com', role: 'recruiter', name: 'Outside' },
      null,
      'cand1',
      {}
    )).rejects.toMatchObject({ statusCode: 403 });
  });
});
