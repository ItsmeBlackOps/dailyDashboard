import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { candidateModel } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';
import { userService } from '../src/services/userService.js';
import { storageService } from '../src/services/storageService.js';
import { emailOutboxRepository } from '../src/services/emailOutboxRepository.js';
import { graphMailService } from '../src/services/graphMailService.js';

// The assignment email sends DELEGATED from the requester's mailbox (same as
// Interview/Assessment Support: graphMailService.sendDelegatedMail → /me/sendMail).
// It requires the caller's Graph token, never enqueues to the app-only outbox
// worker, and surfaces the real Graph failure instead of masking it as
// "Azure mail sender is not configured".

const originalGetCandidateById = candidateModel.getCandidateById;
const originalUpdateCandidateById = candidateModel.updateCandidateById;
const originalGetUserByEmail = userModel.getUserByEmail;
const originalGetAllUsers = userModel.getAllUsers;
const originalCollectManageableUsers = userService.collectManageableUsers;
const originalFetchObjectAsBase64 = storageService.fetchObjectAsBase64;
const originalEnqueue = emailOutboxRepository.enqueue;
const originalSendDelegatedMail = graphMailService.sendDelegatedMail;

afterEach(() => {
  candidateModel.getCandidateById = originalGetCandidateById;
  candidateModel.updateCandidateById = originalUpdateCandidateById;
  userModel.getUserByEmail = originalGetUserByEmail;
  userModel.getAllUsers = originalGetAllUsers;
  userService.collectManageableUsers = originalCollectManageableUsers;
  storageService.fetchObjectAsBase64 = originalFetchObjectAsBase64;
  emailOutboxRepository.enqueue = originalEnqueue;
  graphMailService.sendDelegatedMail = originalSendDelegatedMail;
  jest.restoreAllMocks();
});

const TOKEN = 'delegated-graph-token';
const sentPayload = () => graphMailService.sendDelegatedMail.mock.calls[0][1];

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
  // Delegated send succeeds by default; failure cases override this.
  graphMailService.sendDelegatedMail = jest.fn().mockResolvedValue({ id: 'graph-msg-1' });
  // Present so we can assert it is NEVER called (no app-only fallback).
  emailOutboxRepository.enqueue = jest.fn();
  return candidate;
}

describe('candidateService.sendAssignmentEmail — delegated send (Interview-Support-style)', () => {
  it('sends via sendDelegatedMail, records audit + flips ackEmail, returns { status: "sent" }, never enqueues', async () => {
    setupHappyPath();
    const result = await candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      TOKEN,
      'cand1',
      {}
    );
    expect(result).toMatchObject({ success: true, status: 'sent' });
    expect(graphMailService.sendDelegatedMail).toHaveBeenCalledTimes(1);
    expect(graphMailService.sendDelegatedMail.mock.calls[0][0]).toBe(TOKEN);
    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith(
      'cand1',
      expect.objectContaining({
        _pushAssignmentEmail: expect.objectContaining({ status: 'sent', via: 'delegated' }),
        ackEmail: 'Sent',
        ackEmailAt: expect.any(Date)
      })
    );
    expect(emailOutboxRepository.enqueue).not.toHaveBeenCalled();
  });

  it('sent payload carries the verbatim §6.2 body + tokens replaced', async () => {
    setupHappyPath();
    await candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      TOKEN,
      'cand1',
      {}
    );
    const msg = sentPayload().message;
    expect(msg.subject).toBe('Assignment: Jane Doe – Software Developer – OPT');
    expect(msg.body.content).toContain('Hi Lead One,');
    expect(msg.body.content).toContain('to Recruit One');
    expect(msg.body.content).toMatch(/MM User<\/p>$/);
  });

  it('always injects the configured permanent CC, even without a manager', async () => {
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
      TOKEN,
      'cand1',
      {}
    );
    const ccs = sentPayload().message.ccRecipients.map((r) => r.emailAddress.address);
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
      TOKEN,
      'cand1',
      { attachmentIds: ['att-2'] }
    );
    expect(storageService.fetchObjectAsBase64).toHaveBeenCalledTimes(1);
    const atts = sentPayload().message.attachments;
    expect(atts).toHaveLength(1);
    expect(atts[0].name).toBe('cred.pdf');
  });

  it('respects a subject override from the modal', async () => {
    setupHappyPath();
    await candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      TOKEN,
      'cand1',
      { subject: 'Custom Subject — urgent' }
    );
    expect(sentPayload().message.subject).toBe('Custom Subject — urgent');
  });
});

describe('candidateService.sendAssignmentEmail — failure handling', () => {
  it('throws 400 GRAPH_TOKEN_REQUIRED when no Graph token is supplied (never enqueues)', async () => {
    setupHappyPath();
    await expect(candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      null,
      'cand1',
      {}
    )).rejects.toMatchObject({ statusCode: 400, code: 'GRAPH_TOKEN_REQUIRED' });
    expect(graphMailService.sendDelegatedMail).not.toHaveBeenCalled();
    expect(emailOutboxRepository.enqueue).not.toHaveBeenCalled();
  });

  it('surfaces the real Graph error (status + body) on a delegated failure — no app-only fallback', async () => {
    setupHappyPath();
    const graphErr = new Error('Microsoft Graph mail request failed');
    graphErr.status = 403;
    graphErr.responseBody = { error: { code: 'ErrorAccessDenied', message: 'Access is denied. Check credentials and try again.' } };
    graphMailService.sendDelegatedMail = jest.fn().mockRejectedValue(graphErr);

    await expect(candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      TOKEN,
      'cand1',
      {}
    )).rejects.toMatchObject({
      statusCode: 403,
      code: 'GRAPH_SEND_FAILED',
      message: expect.stringContaining('Access is denied')
    });
    expect(emailOutboxRepository.enqueue).not.toHaveBeenCalled();
    // a failed send must NOT flip ackEmail
    expect(candidateModel.updateCandidateById).not.toHaveBeenCalled();
  });

  it('maps a 5xx Graph failure to 502', async () => {
    setupHappyPath();
    const graphErr = new Error('Microsoft Graph mail request failed');
    graphErr.status = 503;
    graphErr.responseBody = { error: { code: 'ServiceUnavailable', message: 'Try again later' } };
    graphMailService.sendDelegatedMail = jest.fn().mockRejectedValue(graphErr);

    await expect(candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      TOKEN,
      'cand1',
      {}
    )).rejects.toMatchObject({ statusCode: 502, code: 'GRAPH_SEND_FAILED' });
  });
});

describe('candidateService.sendAssignmentEmail — gates (unchanged, run before the send)', () => {
  it('401 if user is missing role', async () => {
    setupHappyPath();
    await expect(candidateService.sendAssignmentEmail(
      { email: 'x@y' }, TOKEN, 'cand1', {}
    )).rejects.toMatchObject({ statusCode: 401 });
  });

  it('403 for technical roles (lead / am / expert / user)', async () => {
    setupHappyPath();
    for (const role of ['lead', 'am', 'expert', 'user']) {
      await expect(candidateService.sendAssignmentEmail(
        { email: `${role}@company.com`, role }, TOKEN, 'cand1', {}
      )).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('400 if candidate has no Team Lead', async () => {
    setupHappyPath({ teamLead: '' });
    await expect(candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM' }, TOKEN, 'cand1', {}
    )).rejects.toMatchObject({ statusCode: 400 });
  });

  it('400 if candidate has no attachments', async () => {
    setupHappyPath({ attachments: [] });
    await expect(candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM' }, TOKEN, 'cand1', {}
    )).rejects.toMatchObject({ statusCode: 400 });
  });

  it('403 when the candidate recruiter is out of the actor\'s scope', async () => {
    setupHappyPath();
    userService.collectManageableUsers = jest.fn().mockReturnValue([]);
    await expect(candidateService.sendAssignmentEmail(
      { email: 'rec.outside@company.com', role: 'recruiter', name: 'Outside' }, TOKEN, 'cand1', {}
    )).rejects.toMatchObject({ statusCode: 403 });
  });
});
