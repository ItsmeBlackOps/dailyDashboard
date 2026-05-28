import { describe, it, expect, jest, afterEach, beforeEach } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { candidateModel } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';
import { userService } from '../src/services/userService.js';
import { storageService } from '../src/services/storageService.js';
import { graphMailService } from '../src/services/graphMailService.js';
import { notificationService } from '../src/services/notificationService.js';
import { config } from '../src/config/index.js';

const originalGetCandidateById = candidateModel.getCandidateById;
const originalUpdateCandidateById = candidateModel.updateCandidateById;
const originalGetUserByEmail = userModel.getUserByEmail;
const originalGetAllUsers = userModel.getAllUsers;
const originalCollectManageableUsers = userService.collectManageableUsers;
const originalFetchObjectAsBase64 = storageService.fetchObjectAsBase64;
const originalSendMail = graphMailService.sendMail;
const originalBroadcastToWatchers = notificationService.broadcastToWatchers;
const originalRetryDelays = config.assignmentEmail?.retryDelaysMs;

afterEach(() => {
  candidateModel.getCandidateById = originalGetCandidateById;
  candidateModel.updateCandidateById = originalUpdateCandidateById;
  userModel.getUserByEmail = originalGetUserByEmail;
  userModel.getAllUsers = originalGetAllUsers;
  userService.collectManageableUsers = originalCollectManageableUsers;
  storageService.fetchObjectAsBase64 = originalFetchObjectAsBase64;
  graphMailService.sendMail = originalSendMail;
  notificationService.broadcastToWatchers = originalBroadcastToWatchers;
  if (config.assignmentEmail) {
    config.assignmentEmail.retryDelaysMs = originalRetryDelays;
  }
  jest.restoreAllMocks();
});

// Common in-scope happy-path fixture.
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
    { email: 'admin1@company.com', role: 'admin', active: true },
    { email: 'admin2@company.com', role: 'admin', active: false }, // inactive — skipped
    { email: 'recruit.one@company.com', role: 'recruiter', active: true },
    // Tushar (for _findEmailByName('Tushar Ahuja'))
    { email: 'tushar.ahuja@silverspaceinc.com', role: 'manager', team: 'marketing', active: true }
  ]);

  storageService.fetchObjectAsBase64 = jest.fn().mockResolvedValue({
    base64: 'cGRm',
    contentType: 'application/pdf',
    contentLength: 3
  });

  graphMailService.sendMail = jest.fn().mockResolvedValue({});
  notificationService.broadcastToWatchers = jest.fn().mockResolvedValue([]);

  // Zero retry delays so tests don't wait real seconds.
  if (config.assignmentEmail) {
    config.assignmentEmail.retryDelaysMs = [0, 0, 0];
  }
  return candidate;
}

describe('candidateService.sendAssignmentEmail — happy path', () => {
  it('sends mail, pushes audit (status=sent), flips ackEmail to Sent', async () => {
    setupHappyPath();
    const result = await candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      'fake-assertion',
      'cand1',
      {}
    );
    expect(result.success).toBe(true);
    expect(result.audit.status).toBe('sent');
    expect(result.audit.attempts).toBe(1);
    expect(result.audit.to).toEqual(['recruit.one@company.com']);
    expect(result.audit.cc).toEqual(expect.arrayContaining(['tushar.ahuja@silverspaceinc.com', 'lead.one@company.com']));
    expect(result.audit.attachmentIds).toEqual(['att-1']);

    expect(graphMailService.sendMail).toHaveBeenCalledTimes(1);
    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith(
      'cand1',
      expect.objectContaining({
        _pushAssignmentEmail: expect.objectContaining({ status: 'sent' }),
        ackEmail: 'Sent',
        ackEmailAt: expect.any(Date)
      })
    );
  });

  it('passes a Graph payload whose body contains the verbatim template + tokens', async () => {
    setupHappyPath();
    await candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      'fake-assertion',
      'cand1',
      {}
    );
    const payload = graphMailService.sendMail.mock.calls[0][1];
    expect(payload.message.subject).toBe('Assignment: Jane Doe – Software Developer – OPT');
    const html = payload.message.body.content;
    expect(html).toContain('Hi Lead One,'); // teamLead display
    expect(html).toContain('to Recruit One'); // recruiter display
    expect(html).toMatch(/MM User<\/p>$/);     // sender display
  });

  it('always includes the configured permanent CC, even when the candidate has no manager', async () => {
    setupHappyPath();
    userModel.getUserByEmail = jest.fn((email) => {
      if ((email || '').toLowerCase() === 'recruit.one@company.com') {
        // No manager field on the recruiter record at all.
        return { email: 'recruit.one@company.com', role: 'recruiter', active: true };
      }
      if ((email || '').toLowerCase() === 'lead.one@company.com') {
        return { email: 'lead.one@company.com', role: 'lead', active: true };
      }
      return null;
    });
    await candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      'fake-assertion',
      'cand1',
      {}
    );
    const payload = graphMailService.sendMail.mock.calls[0][1];
    const ccs = payload.message.ccRecipients.map((r) => r.emailAddress.address);
    expect(ccs).toContain('tushar.ahuja@silverspaceinc.com');
  });

  it('uses only the explicitly-selected attachment ids when supplied', async () => {
    const candidate = setupHappyPath({
      attachments: [
        { id: 'att-1', filename: 'r.pdf', mimeType: 'application/pdf', s3Key: 'r.pdf', url: 'u1', size: 1, uploadedAt: new Date(), uploadedBy: 'x' },
        { id: 'att-2', filename: 'cred.pdf', mimeType: 'application/pdf', s3Key: 'c.pdf', url: 'u2', size: 1, uploadedAt: new Date(), uploadedBy: 'x' }
      ]
    });
    await candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      'fake-assertion',
      'cand1',
      { attachmentIds: ['att-2'] }
    );
    expect(storageService.fetchObjectAsBase64).toHaveBeenCalledTimes(1);
    const payload = graphMailService.sendMail.mock.calls[0][1];
    expect(payload.message.attachments).toHaveLength(1);
    expect(payload.message.attachments[0].name).toBe('cred.pdf');
    void candidate;
  });

  it('respects a subject override from the modal', async () => {
    setupHappyPath();
    await candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM User' },
      'fake-assertion',
      'cand1',
      { subject: 'Custom Subject — urgent' }
    );
    const payload = graphMailService.sendMail.mock.calls[0][1];
    expect(payload.message.subject).toBe('Custom Subject — urgent');
  });
});

describe('candidateService.sendAssignmentEmail — gates', () => {
  it('401 if user is missing role', async () => {
    setupHappyPath();
    await expect(candidateService.sendAssignmentEmail(
      { email: 'x@y' }, // no role
      'fake-assertion',
      'cand1',
      {}
    )).rejects.toMatchObject({ statusCode: 401 });
  });

  it('403 for technical roles (lead / am / expert / user)', async () => {
    setupHappyPath();
    for (const role of ['lead', 'am', 'expert', 'user']) {
      await expect(candidateService.sendAssignmentEmail(
        { email: `${role}@company.com`, role },
        'fake-assertion',
        'cand1',
        {}
      )).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('401 if Bearer/userAssertion is missing', async () => {
    setupHappyPath();
    await expect(candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM' },
      '', // missing
      'cand1',
      {}
    )).rejects.toMatchObject({ statusCode: 401 });
  });

  it('400 if candidate has no Team Lead', async () => {
    setupHappyPath({ teamLead: '' });
    await expect(candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM' },
      'fake-assertion',
      'cand1',
      {}
    )).rejects.toMatchObject({ statusCode: 400 });
  });

  it('400 if candidate has no attachments', async () => {
    setupHappyPath({ attachments: [] });
    await expect(candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM' },
      'fake-assertion',
      'cand1',
      {}
    )).rejects.toMatchObject({ statusCode: 400 });
  });

  it('403 when the candidate recruiter is out of the actor\'s scope', async () => {
    setupHappyPath();
    // Acting recruiter does NOT manage rec.one
    userService.collectManageableUsers = jest.fn().mockReturnValue([]);
    await expect(candidateService.sendAssignmentEmail(
      { email: 'rec.outside@company.com', role: 'recruiter', name: 'Outside' },
      'fake-assertion',
      'cand1',
      {}
    )).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('candidateService.sendAssignmentEmail — retry + failure', () => {
  it('retries on a transient 500 and succeeds on the 2nd attempt', async () => {
    setupHappyPath();
    const transient = new Error('Graph 500');
    transient.statusCode = 500;
    graphMailService.sendMail = jest.fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce({});
    const result = await candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM' },
      'fake-assertion',
      'cand1',
      {}
    );
    expect(result.success).toBe(true);
    expect(result.audit.status).toBe('sent');
    expect(result.audit.attempts).toBe(2);
    expect(graphMailService.sendMail).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on a non-transient 400', async () => {
    setupHappyPath();
    const nonTransient = new Error('Bad payload');
    nonTransient.statusCode = 400;
    graphMailService.sendMail = jest.fn().mockRejectedValue(nonTransient);
    await expect(candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM' },
      'fake-assertion',
      'cand1',
      {}
    )).rejects.toMatchObject({ statusCode: 502, audit: expect.objectContaining({ status: 'failed', attempts: 1 }) });
    expect(graphMailService.sendMail).toHaveBeenCalledTimes(1);
  });

  it('after exhausting all transient retries writes a failed audit + notifies admins', async () => {
    setupHappyPath();
    const transient = Object.assign(new Error('Graph 503'), { statusCode: 503 });
    graphMailService.sendMail = jest.fn().mockRejectedValue(transient);
    await expect(candidateService.sendAssignmentEmail(
      { email: 'mm.user@company.com', role: 'mm', name: 'MM' },
      'fake-assertion',
      'cand1',
      {}
    )).rejects.toMatchObject({
      statusCode: 502,
      audit: expect.objectContaining({ status: 'failed', attempts: 4 })
    });
    // 1 initial + 3 retries
    expect(graphMailService.sendMail).toHaveBeenCalledTimes(4);

    // Failed audit row was persisted
    const updateArg = candidateModel.updateCandidateById.mock.calls.at(-1)[1];
    expect(updateArg._pushAssignmentEmail.status).toBe('failed');
    expect(updateArg.ackEmail).toBeUndefined();
    expect(updateArg.ackEmailAt).toBeUndefined();

    // Admins were notified (admin1 active; admin2 inactive should be filtered)
    expect(notificationService.broadcastToWatchers).toHaveBeenCalledTimes(1);
    const [watchers, payload] = notificationService.broadcastToWatchers.mock.calls[0];
    expect(watchers).toContain('admin1@company.com');
    expect(watchers).not.toContain('admin2@company.com');
    expect(payload.type).toBe('assignment-email-failed');
  });
});
