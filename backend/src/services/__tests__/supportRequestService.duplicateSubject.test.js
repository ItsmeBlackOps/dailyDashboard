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

const mockTaskFindToArray = jest.fn();
const mockTaskCollection = {
  find: jest.fn(() => ({
    toArray: mockTaskFindToArray
  }))
};

const mockDatabase = {
  getCollection: jest.fn((collectionName) => {
    if (collectionName === 'taskBody') {
      return mockTaskCollection;
    }
    throw new Error(`Unexpected collection lookup: ${collectionName}`);
  })
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

jest.unstable_mockModule('../../config/database.js', () => ({
  database: mockDatabase
}));

const { supportRequestService } = await import('../supportRequestService.js');
const { config } = await import('../../config/index.js');

const DEFAULT_USER = { email: 'recruiter@example.com', role: 'recruiter' };

const buildExpectedSubject = (isoLocal) => {
  const display = moment.tz(isoLocal, 'YYYY-MM-DDTHH:mm', 'America/New_York').format('MMM D, YYYY [at] hh:mm A');
  return `Interview Support - John Doe - Full Stack - ${display} EST`;
};

const buildPayload = (isoLocal) => ({
  candidateId: 'cand-dup-1',
  endClient: 'acme corp',
  jobTitle: 'software engineer',
  interviewRound: '1st Round',
  interviewDateTime: isoLocal,
  duration: '60',
  contactNumber: '+1 555 0000',
  customMessage: 'Need interview support'
});

describe('supportRequestService duplicate interview subject guard', () => {
  beforeAll(() => {
    config.support.supportTo = 'tech.leaders@silverspaceinc.com';
    config.support.supportCcFallback = [];
    config.support.attachmentMaxBytes = 5 * 1024 * 1024;
  });

  beforeEach(() => {
    jest.clearAllMocks();

    const candidateDoc = {
      id: 'cand-dup-1',
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
      return null;
    });

    mockUserModel.getAllUsers.mockReturnValue([
      { email: 'alice.leader@example.com', role: 'mlead', teamLead: '', manager: 'Bob Manager' },
      { email: 'bob.manager@example.com', role: 'mam', teamLead: '', manager: '' },
      { email: 'recruiter@example.com', role: 'recruiter', teamLead: 'Alice Leader', manager: 'Bob Manager' }
    ]);

    mockTaskFindToArray.mockResolvedValue([]);
    mockGraphMailService.sendDelegatedMail.mockResolvedValue({});
    mockProfileService.getProfile.mockResolvedValue({ success: true, profile: { isComplete: false } });
  });

  it('blocks request with 409 when duplicate exists in subject field', async () => {
    const interviewLocal = moment().tz('America/New_York').add(1, 'day').hour(10).minute(30).second(0).millisecond(0).format('YYYY-MM-DDTHH:mm');
    const expectedSubject = buildExpectedSubject(interviewLocal);
    mockTaskFindToArray.mockResolvedValue([{ subject: expectedSubject }]);

    await expect(
      supportRequestService.sendInterviewSupportRequest(DEFAULT_USER, buildPayload(interviewLocal), {}, 'graph-token')
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'A task with this interview subject already exists. Reply on the same email thread and request deletion from Tasks first. After deletion, submit this request again.'
    });

    expect(mockTaskCollection.find).toHaveBeenCalledWith(
      {
        $or: [
          { subject: { $in: [expectedSubject] } },
          { Subject: { $in: [expectedSubject] } }
        ]
      },
      expect.objectContaining({
        collation: { locale: 'en', strength: 2 }
      })
    );
    expect(mockGraphMailService.sendDelegatedMail).not.toHaveBeenCalled();
  });

  it('blocks request when duplicate exists in legacy Subject field', async () => {
    const interviewLocal = moment().tz('America/New_York').add(1, 'day').hour(11).minute(0).second(0).millisecond(0).format('YYYY-MM-DDTHH:mm');
    const expectedSubject = buildExpectedSubject(interviewLocal);
    mockTaskFindToArray.mockResolvedValue([{ Subject: expectedSubject }]);

    await expect(
      supportRequestService.sendInterviewSupportRequest(DEFAULT_USER, buildPayload(interviewLocal), {}, 'graph-token')
    ).rejects.toMatchObject({
      statusCode: 409
    });

    expect(mockGraphMailService.sendDelegatedMail).not.toHaveBeenCalled();
  });

  it('blocks entire loop submission when one slot subject already exists', async () => {
    const slotOne = moment().tz('America/New_York').add(2, 'day').hour(9).minute(0).second(0).millisecond(0).format('YYYY-MM-DDTHH:mm');
    const slotTwo = moment().tz('America/New_York').add(2, 'day').hour(11).minute(0).second(0).millisecond(0).format('YYYY-MM-DDTHH:mm');
    const subjectTwo = buildExpectedSubject(slotTwo);

    mockTaskFindToArray.mockResolvedValue([{ subject: subjectTwo.toLowerCase() }]);

    const payload = {
      candidateId: 'cand-dup-1',
      endClient: 'acme corp',
      jobTitle: 'software engineer',
      interviewRound: 'Loop Round',
      interviewDateTime: slotOne,
      duration: '60',
      contactNumber: '+1 555 0000',
      loopSlots: JSON.stringify([
        { interviewDateTime: slotOne, durationMinutes: 60 },
        { interviewDateTime: slotTwo, durationMinutes: 45 }
      ])
    };

    await expect(
      supportRequestService.sendInterviewSupportRequest(DEFAULT_USER, payload, {}, 'graph-token')
    ).rejects.toMatchObject({
      statusCode: 409
    });

    expect(mockGraphMailService.sendDelegatedMail).not.toHaveBeenCalled();
  });

  it('sends support email when no duplicate subject exists', async () => {
    const interviewLocal = moment().tz('America/New_York').add(1, 'day').hour(14).minute(0).second(0).millisecond(0).format('YYYY-MM-DDTHH:mm');
    mockTaskFindToArray.mockResolvedValue([]);

    const result = await supportRequestService.sendInterviewSupportRequest(
      DEFAULT_USER,
      buildPayload(interviewLocal),
      {},
      'graph-token'
    );

    expect(result).toEqual({ success: true, message: 'Support request sent successfully' });
    expect(mockTaskCollection.find).toHaveBeenCalledTimes(1);
    expect(mockGraphMailService.sendDelegatedMail).toHaveBeenCalledTimes(1);
  });
});
