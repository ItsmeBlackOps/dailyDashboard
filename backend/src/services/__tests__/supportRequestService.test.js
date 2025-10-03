import { jest } from '@jest/globals';

const mockCandidateModel = {
  getCandidateById: jest.fn()
};

const mockUserModel = {
  getUserByEmail: jest.fn(),
  getAllUsers: jest.fn()
};

const mockGraphMailService = {
  sendDelegatedMail: jest.fn()
};

const mockCandidateService = {
  formatCandidateRecord: jest.fn()
};

const mockProfileService = {
  getProfile: jest.fn()
};

jest.unstable_mockModule('../../models/Candidate.js', () => ({
  candidateModel: mockCandidateModel
}));

jest.unstable_mockModule('../../models/User.js', () => ({
  userModel: mockUserModel
}));

jest.unstable_mockModule('../graphMailService.js', () => ({
  graphMailService: mockGraphMailService
}));

jest.unstable_mockModule('../candidateService.js', () => ({
  candidateService: mockCandidateService
}));

jest.unstable_mockModule('../profileService.js', () => ({
  profileService: mockProfileService
}));

const { supportRequestService } = await import('../supportRequestService.js');
const { config } = await import('../../config/index.js');

describe('supportRequestService.sendInterviewSupportRequest', () => {
  beforeAll(() => {
    config.support.supportTo = 'tech.leaders@silverspaceinc.com';
    config.support.supportCcFallback = [];
    config.support.attachmentMaxBytes = 5 * 1024 * 1024;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockProfileService.getProfile.mockResolvedValue({ success: true, profile: { isComplete: false } });
  });

  it('sends email with formatted payload for recruiter', async () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const candidateDoc = {
      id: 'cand-1',
      name: 'john doe',
      technology: 'full stack',
      email: 'john@example.com',
      recruiter: 'recruiter@example.com',
      contact: '+1 555 0000'
    };

    mockCandidateModel.getCandidateById.mockResolvedValue(candidateDoc);
    mockCandidateService.formatCandidateRecord.mockReturnValue({
      ...candidateDoc,
      name: 'John Doe',
      technology: 'Full Stack',
      recruiterRaw: 'recruiter@example.com'
    });

    mockUserModel.getUserByEmail.mockImplementation((email) => {
      if (email === 'recruiter@example.com') {
        return {
          teamLead: 'Alice Leader',
          manager: 'Bob Manager'
        };
      }
      if (email === 'alice.leader@example.com') {
        return { teamLead: '', manager: 'Bob Manager' };
      }
      return null;
    });

    mockUserModel.getAllUsers.mockReturnValue([
      { email: 'alice.leader@example.com', role: 'mlead', teamLead: '', manager: 'Bob Manager' },
      { email: 'bob.manager@example.com', role: 'mam', teamLead: '', manager: '' },
      { email: 'recruiter@example.com', role: 'recruiter', teamLead: 'Alice Leader', manager: 'Bob Manager' }
    ]);

    mockGraphMailService.sendDelegatedMail.mockResolvedValue({});

    const payload = {
      candidateId: 'cand-1',
      endClient: 'acme corp',
      jobTitle: 'software engineer',
      interviewRound: '1st Round',
      interviewDateTime: futureIso,
      duration: '60',
      contactNumber: '+1 555 0000'
    };

    const result = await supportRequestService.sendInterviewSupportRequest(
      { email: 'recruiter@example.com', role: 'recruiter' },
      payload,
      {},
      'user-token'
    );

    expect(result).toEqual({ success: true, message: 'Support request sent successfully' });

    expect(mockGraphMailService.sendDelegatedMail).toHaveBeenCalledTimes(1);
    const [tokenArg, args] = mockGraphMailService.sendDelegatedMail.mock.calls[0];
    expect(tokenArg).toBe('user-token');
    expect(args.message.toRecipients).toEqual([
      { emailAddress: { address: 'tech.leaders@silverspaceinc.com' } }
    ]);
    expect(args.message.ccRecipients).toEqual(expect.arrayContaining([
      { emailAddress: { address: 'alice.leader@example.com' } },
      { emailAddress: { address: 'bob.manager@example.com' } }
    ]));
    expect(args.message.subject).toContain('Interview Support - John Doe - Full Stack');
    expect(args.message.subject).toContain(' at ');
    expect(args.message.body.content).toContain(' at ');
    expect(args.message.body.content).toContain('60 minutes');
    expect(args.saveToSentItems).toBe(true);
  });

  it('sends multiple loop slot emails when loop slots are provided', async () => {
    const futureIsoOne = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const futureIsoTwo = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const candidateDoc = {
      id: 'cand-1',
      name: 'john doe',
      technology: 'full stack',
      email: 'john@example.com',
      recruiter: 'recruiter@example.com',
      contact: '+1 555 0000'
    };

    mockCandidateModel.getCandidateById.mockResolvedValue(candidateDoc);
    mockCandidateService.formatCandidateRecord.mockReturnValue({
      ...candidateDoc,
      name: 'John Doe',
      technology: 'Full Stack',
      recruiterRaw: 'recruiter@example.com'
    });

    mockUserModel.getUserByEmail.mockImplementation((email) => {
      if (email === 'recruiter@example.com') {
        return {
          teamLead: 'Alice Leader',
          manager: 'Bob Manager'
        };
      }
      if (email === 'alice.leader@example.com') {
        return { teamLead: '', manager: 'Bob Manager' };
      }
      return null;
    });

    mockUserModel.getAllUsers.mockReturnValue([
      { email: 'alice.leader@example.com', role: 'mlead', teamLead: '', manager: 'Bob Manager' },
      { email: 'bob.manager@example.com', role: 'mam', teamLead: '', manager: '' },
      { email: 'recruiter@example.com', role: 'recruiter', teamLead: 'Alice Leader', manager: 'Bob Manager' }
    ]);

    mockGraphMailService.sendDelegatedMail.mockResolvedValue({});

    const payload = {
      candidateId: 'cand-1',
      endClient: 'acme corp',
      jobTitle: 'software engineer',
      interviewRound: 'Loop Round',
      loopSlots: JSON.stringify([
        { interviewDateTime: futureIsoOne, durationMinutes: 60 },
        { interviewDateTime: futureIsoTwo, durationMinutes: 45 }
      ]),
      contactNumber: '+1 555 0000'
    };

    const result = await supportRequestService.sendInterviewSupportRequest(
      { email: 'recruiter@example.com', role: 'recruiter' },
      payload,
      {},
      'user-token'
    );

    expect(result).toEqual({ success: true, message: 'Support requests sent for 2 slots' });
    expect(mockGraphMailService.sendDelegatedMail).toHaveBeenCalledTimes(2);
  });

  it('appends sanitized signature when profile metadata is complete', async () => {
    const futureIso = new Date(Date.now() + 90 * 60 * 1000).toISOString();

    const candidateDoc = {
      id: 'cand-2',
      name: 'sara doe',
      technology: 'devops',
      email: 'sara@example.com',
      recruiter: 'recruiter@silverspaceinc.com',
      contact: '+1 555 1111'
    };

    mockCandidateModel.getCandidateById.mockResolvedValue(candidateDoc);
    mockCandidateService.formatCandidateRecord.mockReturnValue({
      ...candidateDoc,
      name: 'Sara Doe',
      technology: 'Devops',
      recruiterRaw: 'recruiter@silverspaceinc.com'
    });

    mockUserModel.getUserByEmail.mockImplementation((email) => {
      if (email === 'recruiter@silverspaceinc.com') {
        return {
          teamLead: 'Alice Leader',
          manager: 'Bob Manager'
        };
      }
      return null;
    });

    mockUserModel.getAllUsers.mockReturnValue([
      { email: 'alice.leader@example.com', role: 'mlead', teamLead: '', manager: 'Bob Manager' },
      { email: 'bob.manager@example.com', role: 'mam', teamLead: '', manager: '' }
    ]);

    mockGraphMailService.sendDelegatedMail.mockResolvedValue({});

    mockProfileService.getProfile.mockResolvedValue({
      success: true,
      profile: {
        email: 'recruiter@silverspaceinc.com',
        displayName: 'Recruiter Name',
        jobRole: 'Senior Recruiter',
        phoneNumber: '+1 (555) 222-3333',
        companyName: 'Silverspace Inc.',
        companyUrl: 'https://www.silverspaceinc.com',
        isComplete: true
      }
    });

    await supportRequestService.sendInterviewSupportRequest(
      { email: 'recruiter@silverspaceinc.com', role: 'recruiter' },
      {
        candidateId: 'cand-2',
        endClient: 'Acme',
        jobTitle: 'DevOps Engineer',
        interviewRound: '1st Round',
        interviewDateTime: futureIso,
        duration: '45',
        contactNumber: '+1 555 1111'
      },
      {},
      'graph-token'
    );

    const lastCall = mockGraphMailService.sendDelegatedMail.mock.calls[mockGraphMailService.sendDelegatedMail.mock.calls.length - 1];
    const [, args] = lastCall;
    expect(args.message.body.content).toContain('Recruiter Name');
    expect(args.message.body.content).toContain('📧 recruiter@silverspaceinc.com');
    expect(args.message.body.content).toContain('Silverspace Inc.');
  });

  it('rejects unsupported roles', async () => {
    await expect(
      supportRequestService.sendInterviewSupportRequest(
        { email: 'lead@example.com', role: 'lead' },
        {
          candidateId: 'cand-1',
          endClient: 'client',
          jobTitle: 'role',
          interviewRound: '1st Round',
          interviewDateTime: '2024-10-05T14:30:00.000Z',
          duration: '60',
          contactNumber: '1234567890'
        },
        {},
        'user-token'
      )
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('validates required fields', async () => {
    mockCandidateModel.getCandidateById.mockResolvedValue({
      id: 'cand-1',
      name: 'Jane Doe',
      technology: 'QA',
      email: 'jane@example.com',
      recruiter: 'recruiter@example.com',
      contact: '123'
    });

    mockCandidateService.formatCandidateRecord.mockReturnValue({
      id: 'cand-1',
      name: 'Jane Doe',
      technology: 'QA',
      email: 'jane@example.com',
      recruiterRaw: 'recruiter@example.com',
      contact: '123'
    });

    mockUserModel.getUserByEmail.mockReturnValue({ teamLead: 'Alice Leader', manager: 'Bob Manager' });
    mockUserModel.getAllUsers.mockReturnValue([
      { email: 'alice.leader@example.com', role: 'mlead', teamLead: '', manager: 'Bob Manager' },
      { email: 'bob.manager@example.com', role: 'mam', teamLead: '', manager: '' }
    ]);

    await expect(
      supportRequestService.sendInterviewSupportRequest(
        { email: 'recruiter@example.com', role: 'recruiter' },
        {
          candidateId: 'cand-1',
          endClient: '',
          jobTitle: 'role',
          interviewRound: '1st Round',
          interviewDateTime: '2024-10-05T14:30:00.000Z',
          duration: '60',
          contactNumber: '123'
        },
        {},
        'user-token'
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
