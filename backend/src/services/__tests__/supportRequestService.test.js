import { jest } from '@jest/globals';
import moment from 'moment-timezone';

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
    const futureMoment = moment().tz('America/New_York').add(5, 'hours').startOf('minute');
    const futureLocal = futureMoment.format('YYYY-MM-DDTHH:mm');

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
        return { teamLead: 'Alice Leader', manager: 'Bob Manager' };
      }
      if (email === 'alice.leader@example.com') {
        return { teamLead: '', manager: 'Bob Manager' };
      }
      if (email === 'bob.manager@example.com') {
        return { teamLead: '', manager: 'Carol Mm' };
      }
      if (email === 'carol.mm@example.com') {
        return { teamLead: '', manager: '' };
      }
      return null;
    });

    mockUserModel.getAllUsers.mockReturnValue([
      { email: 'alice.leader@example.com', role: 'mlead', teamLead: '', manager: 'Bob Manager' },
      { email: 'bob.manager@example.com', role: 'mam', teamLead: '', manager: 'Carol Mm' },
      { email: 'carol.mm@example.com', role: 'mm', teamLead: '', manager: '' },
      { email: 'recruiter@example.com', role: 'recruiter', teamLead: 'Alice Leader', manager: 'Bob Manager' }
    ]);

    mockGraphMailService.sendDelegatedMail.mockResolvedValue({});

    const payload = {
      candidateId: 'cand-1',
      endClient: 'acme corp',
      jobTitle: 'software engineer',
      interviewRound: '1st Round',
      interviewDateTime: futureLocal,
      duration: '60',
      contactNumber: '+1 555 0000',
      customMessage: 'Need interview support'
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
    // recruiter is the sender — excluded from CC; mlead, mam, mm included
    expect(args.message.ccRecipients).toEqual(expect.arrayContaining([
      { emailAddress: { address: 'alice.leader@example.com' } },
      { emailAddress: { address: 'bob.manager@example.com' } },
      { emailAddress: { address: 'carol.mm@example.com' } }
    ]));
    const ccAddresses = args.message.ccRecipients.map((r) => r.emailAddress.address);
    expect(ccAddresses).not.toContain('recruiter@example.com');
    expect(args.message.subject).toContain('Interview Support - John Doe - Full Stack');
    expect(args.message.subject).toContain(' at ');
    expect(args.message.subject).toMatch(/EST$/);
    expect(args.message.body.content).toContain(' at ');
    expect(args.message.body.content).toContain('EST');
    expect(args.message.body.content).toContain('60 minutes');
    expect(args.saveToSentItems).toBe(true);
  });

  it('sends multiple loop slot emails when loop slots are provided', async () => {
    const futureSlotOne = moment().tz('America/New_York').add(5, 'hours').startOf('minute');
    const futureSlotTwo = futureSlotOne.clone().add(1, 'hour');

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
        return { teamLead: 'Alice Leader', manager: 'Bob Manager' };
      }
      if (email === 'alice.leader@example.com') {
        return { teamLead: '', manager: 'Bob Manager' };
      }
      if (email === 'bob.manager@example.com') {
        return { teamLead: '', manager: 'Carol Mm' };
      }
      if (email === 'carol.mm@example.com') {
        return { teamLead: '', manager: '' };
      }
      return null;
    });

    mockUserModel.getAllUsers.mockReturnValue([
      { email: 'alice.leader@example.com', role: 'mlead', teamLead: '', manager: 'Bob Manager' },
      { email: 'bob.manager@example.com', role: 'mam', teamLead: '', manager: 'Carol Mm' },
      { email: 'carol.mm@example.com', role: 'mm', teamLead: '', manager: '' },
      { email: 'recruiter@example.com', role: 'recruiter', teamLead: 'Alice Leader', manager: 'Bob Manager' }
    ]);

    mockGraphMailService.sendDelegatedMail.mockResolvedValue({});

    const payload = {
      candidateId: 'cand-1',
      endClient: 'acme corp',
      jobTitle: 'software engineer',
      interviewRound: 'Loop Round',
      loopSlots: JSON.stringify([
        { interviewDateTime: futureSlotOne.format('YYYY-MM-DDTHH:mm'), durationMinutes: 60 },
        { interviewDateTime: futureSlotTwo.format('YYYY-MM-DDTHH:mm'), durationMinutes: 45 }
      ]),
      contactNumber: '+1 555 0000',
      customMessage: 'Loop round support request'
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
    const futureLocal = moment().tz('America/New_York').add(5, 'hours').startOf('minute').format('YYYY-MM-DDTHH:mm');

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
        interviewDateTime: futureLocal,
        duration: '45',
        contactNumber: '+1 555 1111',
        customMessage: 'Need interview support'
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
          contactNumber: '1234567890',
          customMessage: 'Need interview support'
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
          contactNumber: '123',
          customMessage: 'Need interview support'
        },
        {},
        'user-token'
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects same-day interviews scheduled within four hours', async () => {
    jest.useFakeTimers();
    const base = moment.tz('America/New_York').startOf('day').add(9, 'hours');
    jest.setSystemTime(base.toDate());

    try {
      const soonIso = base.clone().add(2, 'hours').toISOString();

      mockCandidateModel.getCandidateById.mockResolvedValue({
        id: 'cand-4',
        name: 'lee doe',
        technology: 'python',
        email: 'lee@example.com',
        recruiter: 'recruiter@example.com',
        contact: '+1 555 4444'
      });

      mockCandidateService.formatCandidateRecord.mockReturnValue({
        id: 'cand-4',
        name: 'Lee Doe',
        technology: 'Python',
        email: 'lee@example.com',
        recruiterRaw: 'recruiter@example.com',
        contact: '+1 555 4444'
      });

      mockUserModel.getUserByEmail.mockReturnValue({ teamLead: 'Alice Leader', manager: 'Bob Manager' });
      mockUserModel.getAllUsers.mockReturnValue([
        { email: 'alice.leader@example.com', role: 'mlead', teamLead: '', manager: 'Bob Manager' },
        { email: 'bob.manager@example.com', role: 'mam', teamLead: '', manager: '' },
        { email: 'recruiter@example.com', role: 'recruiter', teamLead: 'Alice Leader', manager: 'Bob Manager' }
      ]);

       finally {
        jest.useRealTimers();
      }
    });

  it('excludes sender from cc and includes full chain when mam submits for another candidate', async () => {
    const futureLocal = moment().tz('America/New_York').add(5, 'hours').startOf('minute').format('YYYY-MM-DDTHH:mm');

    mockCandidateModel.getCandidateById.mockResolvedValue({
      id: 'cand-5',
      name: 'jane smith',
      technology: 'python',
      email: 'jane@example.com',
      recruiter: 'recruiter@example.com',
      contact: '+1 555 9999'
    });

    mockCandidateService.formatCandidateRecord.mockReturnValue({
      id: 'cand-5',
      name: 'Jane Smith',
      technology: 'Python',
      email: 'jane@example.com',
      recruiterRaw: 'recruiter@example.com',
      contact: '+1 555 9999'
    });

    mockUserModel.getUserByEmail.mockImplementation((email) => {
      if (email === 'recruiter@example.com') {
        return { teamLead: 'Alice Leader', manager: 'Bob Manager' };
      }
      if (email === 'bob.manager@example.com') {
        return { teamLead: '', manager: 'Carol Mm' };
      }
      if (email === 'carol.mm@example.com') {
        return { teamLead: '', manager: '' };
      }
      return null;
    });

    mockUserModel.getAllUsers.mockReturnValue([
      { email: 'alice.leader@example.com', role: 'mlead', teamLead: '', manager: 'Bob Manager' },
      { email: 'bob.manager@example.com', role: 'mam', teamLead: '', manager: 'Carol Mm' },
      { email: 'carol.mm@example.com', role: 'mm', teamLead: '', manager: '' },
      { email: 'recruiter@example.com', role: 'recruiter', teamLead: 'Alice Leader', manager: 'Bob Manager' }
    ]);

    mockGraphMailService.sendDelegatedMail.mockResolvedValue({});

    await supportRequestService.sendInterviewSupportRequest(
      { email: 'bob.manager@example.com', role: 'mam' },
      {
        candidateId: 'cand-5',
        endClient: 'Acme Corp',
        jobTitle: 'Python Developer',
        interviewRound: '1st Round',
        interviewDateTime: futureLocal,
        duration: '60'
      },
      {},
      'mam-token'
    );

    const [, args] = mockGraphMailService.sendDelegatedMail.mock.calls[0];
    // mam is sender — excluded; recruiter, mlead, mm are included
    expect(args.message.ccRecipients).toEqual(expect.arrayContaining([
      { emailAddress: { address: 'recruiter@example.com' } },
      { emailAddress: { address: 'alice.leader@example.com' } },
      { emailAddress: { address: 'carol.mm@example.com' } }
    ]));
    const ccAddresses = args.message.ccRecipients.map((r) => r.emailAddress.address);
    expect(ccAddresses).not.toContain('bob.manager@example.com');
  });
});

describe('supportRequestService.sendMockInterviewRequest', () => {
  const mockCandidateDoc = {
    id: 'mock-cand-1',
    name: 'john doe',
    technology: 'react js',
    email: 'john@example.com',
    recruiter: 'recruiter@example.com',
    contact: '+1 555 0000'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    config.support.supportTo = 'tech.leaders@silverspaceinc.com';
    config.support.supportCcFallback = [];
    mockGraphMailService.sendDelegatedMail.mockResolvedValue({});
    mockCandidateModel.getCandidateById.mockResolvedValue(mockCandidateDoc);
    mockCandidateService.formatCandidateRecord.mockReturnValue({
      ...mockCandidateDoc,
      name: 'John Doe',
      technology: 'React Js',
      recruiterRaw: 'recruiter@example.com'
    });
    mockUserModel.getUserByEmail.mockImplementation((email) => {
      if (email === 'recruiter@example.com') {
        return { teamLead: 'Alice Leader', manager: 'Bob Manager' };
      }
      if (email === 'bob.manager@example.com') {
        return { teamLead: '', manager: 'Carol Mm' };
      }
      if (email === 'carol.mm@example.com') {
        return { teamLead: '', manager: '' };
      }
      return null;
    });
    mockUserModel.getAllUsers.mockReturnValue([
      { email: 'alice.leader@example.com', role: 'mlead', teamLead: '', manager: 'Bob Manager' },
      { email: 'bob.manager@example.com', role: 'mam', teamLead: '', manager: 'Carol Mm' },
      { email: 'carol.mm@example.com', role: 'mm', teamLead: '', manager: '' },
      { email: 'recruiter@example.com', role: 'recruiter', teamLead: 'Alice Leader', manager: 'Bob Manager' }
    ]);
  });

  it('sends mock email with stored attachments', async () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const resumeData = Buffer.from('resume-data').toString('base64');
    const jdData = Buffer.from('jd-data').toString('base64');

    const result = await supportRequestService.sendMockInterviewRequest(
      { email: 'recruiter@example.com', role: 'recruiter' },
      {
        candidateId: 'mock-cand-1',
        candidateName: 'john doe',
        candidateEmail: 'john@example.com',
        contactNumber: '+1 555 0000',
        technology: 'react js',
        endClient: 'acme corp',
        interviewRound: 'technical round',
        interviewDateTime: futureIso,
        jobDescriptionText: 'Build APIs and web apps.',
        attachments: [
          { name: 'resume.pdf', type: 'application/pdf', category: 'resume', data: resumeData },
          { name: 'jd.pdf', type: 'application/pdf', category: 'jobDescription', data: jdData }
        ]
      },
      'graph-token'
    );

    expect(result).toEqual({ success: true, message: 'Mock interview request sent' });
    expect(mockGraphMailService.sendDelegatedMail).toHaveBeenCalledTimes(1);

    const [tokenArg, payload] = mockGraphMailService.sendDelegatedMail.mock.calls[0];
    expect(tokenArg).toBe('graph-token');
    expect(payload.message.subject).toContain('Mock Interview - John Doe - React Js - Training');
    expect(payload.message.body.content).toContain('Complete the mock before the day of interview.');
    expect(payload.message.attachments).toHaveLength(2);
    // recruiter is sender — excluded from CC; mlead, mam, mm are included
    expect(payload.message.ccRecipients).toEqual(expect.arrayContaining([
      { emailAddress: { address: 'alice.leader@example.com' } },
      { emailAddress: { address: 'bob.manager@example.com' } },
      { emailAddress: { address: 'carol.mm@example.com' } }
    ]));
    const ccAddresses = payload.message.ccRecipients.map((r) => r.emailAddress.address);
    expect(ccAddresses).not.toContain('recruiter@example.com');
    expect(payload.saveToSentItems).toBe(true);
  });
});

describe('supportRequestService.sendAssessmentSupportRequest', () => {
  const buildFiles = () => ({
    resume: [{
      originalname: 'resume.pdf',
      buffer: Buffer.from('resume-file'),
      mimetype: 'application/pdf',
      size: 256
    }],
    assessmentInfo: [{
      originalname: 'assessment-info.pdf',
      buffer: Buffer.from('info-file'),
      mimetype: 'application/pdf',
      size: 256
    }],
    additionalAttachments: []
  });

  beforeEach(() => {
    jest.clearAllMocks();
    config.support.supportTo = 'tech.leaders@silverspaceinc.com';
    config.support.supportCcFallback = [];
    mockGraphMailService.sendDelegatedMail.mockResolvedValue({});
    mockProfileService.getProfile.mockResolvedValue({ success: true, profile: { isComplete: false } });

    const candidateDoc = {
      id: 'cand-assess-1',
      name: 'jane doe',
      technology: 'java',
      email: 'jane@example.com',
      recruiter: 'recruiter@example.com',
      contact: '+1 555 1234',
      endClient: 'Acme'
    };

    mockCandidateModel.getCandidateById.mockResolvedValue(candidateDoc);
    mockCandidateService.formatCandidateRecord.mockReturnValue({
      ...candidateDoc,
      name: 'Jane Doe',
      technology: 'Java',
      recruiterRaw: 'recruiter@example.com',
      contact: '+1 555 1234'
    });

    mockUserModel.getUserByEmail.mockImplementation((email) => {
      if (email === 'recruiter@example.com') {
        return { teamLead: 'Alice Leader', manager: 'Bob Manager' };
      }
      if (email === 'alice.leader@example.com') {
        return { teamLead: '', manager: 'Bob Manager' };
      }
      if (email === 'bob.manager@example.com') {
        return { teamLead: '', manager: 'Carol Mm' };
      }
      if (email === 'carol.mm@example.com') {
        return { teamLead: '', manager: '' };
      }
      return null;
    });

    mockUserModel.getAllUsers.mockReturnValue([
      { email: 'alice.leader@example.com', role: 'mlead', teamLead: '', manager: 'Bob Manager' },
      { email: 'bob.manager@example.com', role: 'mam', teamLead: '', manager: 'Carol Mm' },
      { email: 'carol.mm@example.com', role: 'mm', teamLead: '', manager: '' },
      { email: 'recruiter@example.com', role: 'recruiter', teamLead: 'Alice Leader', manager: 'Bob Manager' }
    ]);
  });

  it('preserves explicit timezone offsets when provided', async () => {
    const pastKolkata = moment()
      .tz('Asia/Kolkata')
      .subtract(1, 'day')
      .set({ hour: 10, minute: 15, second: 0, millisecond: 0 });
    const payloadTimestamp = pastKolkata.format();
    const expectedDisplay = pastKolkata.format('MMM D, YYYY [at] hh:mm A');
    const expectedLabel = `UTC${pastKolkata.format('Z')}`;

    const payload = {
      candidateId: 'cand-assess-1',
      endClient: 'Acme',
      jobTitle: 'Java Developer',
      technology: 'Java',
      assessmentReceivedDateTime: payloadTimestamp,
      assessmentDuration: '45',
      additionalInfo: 'Needs quick turnaround',
      jobDescriptionText: 'Implement features.',
      screeningDone: 'false'
    };

    const result = await supportRequestService.sendAssessmentSupportRequest(
      { email: 'recruiter@example.com', role: 'recruiter' },
      payload,
      buildFiles(),
      'graph-token'
    );

    expect(result).toEqual({ success: true, message: 'Assessment support request sent' });
    expect(mockGraphMailService.sendDelegatedMail).toHaveBeenCalledTimes(1);

    const [, args] = mockGraphMailService.sendDelegatedMail.mock.calls[0];
    expect(args.message.subject).toContain(expectedLabel);
    expect(args.message.body.content).toContain(`Assessment Received (${expectedLabel})`);
    expect(args.message.body.content).toContain(`${expectedDisplay} ${expectedLabel}`);
  });

  it('falls back to default timezone when offset is missing', async () => {
    const pastEst = moment()
      .tz('America/New_York')
      .subtract(1, 'day')
      .set({ hour: 10, minute: 15, second: 0, millisecond: 0 });
    const payloadTimestamp = pastEst.format('YYYY-MM-DDTHH:mm');
    const expectedDisplay = pastEst.format('MMM D, YYYY [at] hh:mm A');

    const payload = {
      candidateId: 'cand-assess-1',
      endClient: 'Acme',
      jobTitle: 'Java Developer',
      technology: 'Java',
      assessmentReceivedDateTime: payloadTimestamp,
      assessmentDuration: '45',
      screeningDone: 'true'
    };

    const result = await supportRequestService.sendAssessmentSupportRequest(
      { email: 'recruiter@example.com', role: 'recruiter' },
      payload,
      buildFiles(),
      'graph-token'
    );

    expect(result).toEqual({ success: true, message: 'Assessment support request sent' });
    expect(mockGraphMailService.sendDelegatedMail).toHaveBeenCalledTimes(1);

    const [, args] = mockGraphMailService.sendDelegatedMail.mock.calls[0];
    expect(args.message.subject).toContain('EST');
    expect(args.message.body.content).toContain('Assessment Received (EST)');
    expect(args.message.body.content).toContain(`${expectedDisplay} EST`);
  });

  it('preserves UTC timestamps without shifting to EST', async () => {
    const pastUtc = moment
      .utc()
      .subtract(1, 'day')
      .set({ hour: 10, minute: 15, second: 0, millisecond: 0 });
    const payloadTimestamp = pastUtc.toISOString();
    const expectedDisplay = pastUtc.format('MMM D, YYYY [at] hh:mm A');

    const payload = {
      candidateId: 'cand-assess-1',
      endClient: 'Acme',
      jobTitle: 'Java Developer',
      technology: 'Java',
      assessmentReceivedDateTime: payloadTimestamp,
      screeningDone: 'false'
    };

    const result = await supportRequestService.sendAssessmentSupportRequest(
      { email: 'recruiter@example.com', role: 'recruiter' },
      payload,
      buildFiles(),
      'graph-token'
    );

    expect(result).toEqual({ success: true, message: 'Assessment support request sent' });
    expect(mockGraphMailService.sendDelegatedMail).toHaveBeenCalledTimes(1);

    const [, args] = mockGraphMailService.sendDelegatedMail.mock.calls[0];
    expect(args.message.subject).toContain(`${expectedDisplay} UTC`);
    expect(args.message.body.content).toContain('Assessment Received (UTC)');
    expect(args.message.body.content).toContain(`${expectedDisplay} UTC`);
  });

  it('rejects assessment received timestamps that are now or in the future', async () => {
    const futureEst = moment()
      .tz('America/New_York')
      .add(5, 'minutes')
      .startOf('minute');

    const payload = {
      candidateId: 'cand-assess-1',
      endClient: 'Acme',
      jobTitle: 'Java Developer',
      technology: 'Java',
      assessmentReceivedDateTime: futureEst.format('YYYY-MM-DDTHH:mm'),
      screeningDone: 'false'
    };

    await expect(
      supportRequestService.sendAssessmentSupportRequest(
        { email: 'recruiter@example.com', role: 'recruiter' },
        payload,
        buildFiles(),
        'graph-token'
      )
    ).rejects.toMatchObject({
      message: 'Assessment received date and time must be in the past',
      statusCode: 400
    });
  });

  it('excludes sender from cc and includes full chain when mam submits for another candidate', async () => {
    const pastEst = moment().tz('America/New_York').subtract(1, 'day').set({ hour: 10, minute: 0 });

    const payload = {
      candidateId: 'cand-assess-1',
      endClient: 'Acme',
      jobTitle: 'Java Developer',
      technology: 'Java',
      assessmentReceivedDateTime: pastEst.format('YYYY-MM-DDTHH:mm'),
      screeningDone: 'false'
    };

    await supportRequestService.sendAssessmentSupportRequest(
      { email: 'bob.manager@example.com', role: 'mam' },
      payload,
      buildFiles(),
      'mam-token'
    );

    const [, args] = mockGraphMailService.sendDelegatedMail.mock.calls[0];
    // mam is sender — excluded; recruiter, mlead, mm are included
    expect(args.message.ccRecipients).toEqual(expect.arrayContaining([
      { emailAddress: { address: 'recruiter@example.com' } },
      { emailAddress: { address: 'alice.leader@example.com' } },
      { emailAddress: { address: 'carol.mm@example.com' } }
    ]));
    const ccAddresses = args.message.ccRecipients.map((r) => r.emailAddress.address);
    expect(ccAddresses).not.toContain('bob.manager@example.com');
  });
});
