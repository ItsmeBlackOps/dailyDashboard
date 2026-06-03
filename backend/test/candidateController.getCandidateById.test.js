import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Harness mirrors candidateController.marketingInfoWorklist.test.js: stub the
// heavy dependency graph the controller imports at module load. This suite
// exercises getCandidateById, which reads candidateModel.collection.findOne,
// database.getCollection('taskBody'), and candidateService.formatCandidateRecord.
const mockFindOne = jest.fn();
const mockTasksToArray = jest.fn();
const mockFormat = jest.fn();
const mockGetCollection = jest.fn();

jest.unstable_mockModule('../src/models/Candidate.js', () => ({
  __esModule: true,
  candidateModel: { collection: { findOne: mockFindOne } },
  marketingInfoMissingFilter: () => ({ $or: [] }),
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.unstable_mockModule('../src/config/database.js', () => ({ database: { getCollection: mockGetCollection } }));
jest.unstable_mockModule('../src/models/User.js', () => ({ userModel: {} }));
jest.unstable_mockModule('../src/services/storageService.js', () => ({ storageService: {} }));
jest.unstable_mockModule('../src/services/resumeProfileService.js', () => ({ resumeProfileService: {} }));
jest.unstable_mockModule('../src/services/candidateService.js', () => ({ candidateService: { formatCandidateRecord: mockFormat } }));
jest.unstable_mockModule('../src/services/candidateStatusService.js', () => ({ candidateStatusService: {} }));

const { candidateController } = await import('../src/controllers/candidateController.js');

const VALID_ID = 'a'.repeat(24); // 24-hex → real ObjectId() accepts it

function res() {
  const r = { statusCode: 200, body: undefined };
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((p) => { r.body = p; return r; });
  return r;
}

beforeEach(() => {
  jest.clearAllMocks();
  // taskBody.find().sort().limit().toArray()
  mockGetCollection.mockReturnValue({ find: () => ({ sort: () => ({ limit: () => ({ toArray: mockTasksToArray }) }) }) });
  mockTasksToArray.mockResolvedValue([]);
  // Default doc: phone stored under the canonical "Contact No" key only.
  mockFindOne.mockResolvedValue({
    _id: { toString: () => VALID_ID },
    'Candidate Name': 'Dhanya Sree Nathani',
    'Email ID': 'dhanya@x.com',
    'Contact No': '+12193688385',
    Recruiter: 'rec@x.com',
    resumeLink: 'https://x/resume.pdf',
  });
  // Default formatter output for a marketing viewer (not stripped).
  mockFormat.mockReturnValue({
    recruiterRaw: 'rec@x.com',
    teamLead: 'tl@x.com',
    attachments: [{ id: 'att1', filename: 'r.pdf' }],
    visaType: 'H1B',
    company: 'SST',
  });
});

describe('candidateController.getCandidateById', () => {
  it('maps contact from the stored "Contact No" field (not doc.Contact/doc.contact)', async () => {
    const r = res();
    await candidateController.getCandidateById({ user: { email: 'a@x.com', role: 'admin' }, params: { id: VALID_ID } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.candidate.contact).toBe('+12193688385');
  });

  it('surfaces the Send-Assignment gate fields (teamLead + attachments + recruiterRaw) from the canonical formatter', async () => {
    const r = res();
    await candidateController.getCandidateById({ user: { email: 'a@x.com', role: 'admin' }, params: { id: VALID_ID } }, r);
    expect(r.body.candidate.teamLead).toBe('tl@x.com');
    expect(r.body.candidate.attachments).toHaveLength(1);
    expect(r.body.candidate.recruiterRaw).toBe('rec@x.com');
    expect(r.body.candidate.visaType).toBe('H1B');
    // formatCandidateRecord is the single source of PRT truth (called with the raw doc + viewer)
    expect(mockFormat).toHaveBeenCalledWith(expect.objectContaining({ 'Contact No': '+12193688385' }), expect.objectContaining({ role: 'admin' }));
  });

  it('keeps recruiter as the raw email (the detail page runs formatEmail on it)', async () => {
    const r = res();
    await candidateController.getCandidateById({ user: { email: 'a@x.com', role: 'admin' }, params: { id: VALID_ID } }, r);
    expect(r.body.candidate.recruiter).toBe('rec@x.com');
  });

  it('respects PRT visibility: when the formatter strips PRT fields (non-marketing viewer), teamLead is null and attachments is []', async () => {
    mockFormat.mockReturnValueOnce({ recruiterRaw: 'rec@x.com' }); // _applyPrtVisibility removed teamLead/attachments
    const r = res();
    await candidateController.getCandidateById({ user: { email: 'e@x.com', role: 'expert' }, params: { id: VALID_ID } }, r);
    expect(r.body.candidate.teamLead).toBeNull();
    expect(r.body.candidate.attachments).toEqual([]);
  });

  it('401 when unauthenticated', async () => {
    const r = res();
    await candidateController.getCandidateById({ params: { id: VALID_ID } }, r);
    expect(r.statusCode).toBe(401);
  });

  it('400 on an invalid candidate id', async () => {
    const r = res();
    await candidateController.getCandidateById({ user: { email: 'a@x.com', role: 'admin' }, params: { id: 'not-an-objectid' } }, r);
    expect(r.statusCode).toBe(400);
  });

  it('404 when the candidate does not exist', async () => {
    mockFindOne.mockResolvedValueOnce(null);
    const r = res();
    await candidateController.getCandidateById({ user: { email: 'a@x.com', role: 'admin' }, params: { id: VALID_ID } }, r);
    expect(r.statusCode).toBe(404);
  });
});
