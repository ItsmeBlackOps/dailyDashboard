import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();
const mockGetCollection = jest.fn(() => ({ findOne: mockFindOne, updateOne: mockUpdateOne }));
jest.unstable_mockModule('../src/config/database.js', () => ({ database: { getCollection: mockGetCollection } }));
jest.unstable_mockModule('../src/services/meetingProvisioningService.js', () => ({ ensureMeetingForTask: jest.fn(), buildEventPayload: jest.fn() }));
jest.unstable_mockModule('../src/middleware/errorHandler.js', () => ({ asyncHandler: (fn) => fn }));
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.unstable_mockModule('../src/services/taskService.js', () => ({ taskService: {} }));
jest.unstable_mockModule('../src/services/thanksMailService.js', () => ({ thanksMailService: {} }));
jest.unstable_mockModule('../src/services/interviewerQuestionService.js', () => ({ interviewerQuestionService: {} }));
jest.unstable_mockModule('../src/services/interviewDebriefService.js', () => ({ interviewDebriefService: {} }));

const { taskController } = await import('../src/controllers/taskController.js');

const VALID_ID = '507f1f77bcf86cd799439011';
function res() { const r = { statusCode: 200, body: undefined }; r.status = jest.fn((c) => { r.statusCode = c; return r; }); r.json = jest.fn((p) => { r.body = p; return r; }); return r; }
const req = (over = {}) => ({ params: { taskId: VALID_ID }, user: { email: 'exp@x.com', role: 'user' }, body: {}, ...over });

beforeEach(() => { jest.clearAllMocks(); mockUpdateOne.mockResolvedValue({ matchedCount: 1 }); });

describe('taskController.markMeetingStarted', () => {
  it('400 on invalid taskId', async () => {
    const r = res();
    await taskController.markMeetingStarted(req({ params: { taskId: 'nope' } }), r);
    expect(r.statusCode).toBe(400);
  });

  it('404 when task missing', async () => {
    mockFindOne.mockResolvedValue(null);
    const r = res();
    await taskController.markMeetingStarted(req(), r);
    expect(r.statusCode).toBe(404);
  });

  it('assigned expert marks own task started', async () => {
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'exp@x.com' });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'exp@x.com', role: 'user' } }), r);
    expect(r.body).toMatchObject({ success: true, meetingStarted: true, meetingStartedBy: 'exp@x.com' });
    expect(mockUpdateOne).toHaveBeenCalled();
  });

  it('non-assigned expert is 403', async () => {
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'other@x.com' });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'exp@x.com', role: 'user' } }), r);
    expect(r.statusCode).toBe(403);
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it('am / lead / admin can mark any task', async () => {
    for (const role of ['am', 'lead', 'admin']) {
      jest.clearAllMocks();
      mockUpdateOne.mockResolvedValue({ matchedCount: 1 });
      mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'other@x.com' });
      const r = res();
      await taskController.markMeetingStarted(req({ user: { email: 'mgr@x.com', role } }), r);
      expect(r.body.success).toBe(true);
      expect(mockUpdateOne).toHaveBeenCalled();
    }
  });

  it('marketing role is 403', async () => {
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'exp@x.com' });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'rec@x.com', role: 'recruiter' } }), r);
    expect(r.statusCode).toBe(403);
  });

  it('idempotent: already started returns existing without updating', async () => {
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'exp@x.com', meetingStarted: true, meetingStartedAt: 'T0', meetingStartedBy: 'exp@x.com' });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'exp@x.com', role: 'user' } }), r);
    expect(r.body).toMatchObject({ meetingStarted: true, meetingStartedAt: 'T0', meetingStartedBy: 'exp@x.com' });
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  // 60-minute time-window guard (premature-meeting-start remediation).
  it('rejects a mark >60 min before interviewStartAt (TOO_EARLY) and does not write', async () => {
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'exp@x.com', interviewStartAt: future });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'exp@x.com', role: 'user' } }), r);
    expect(r.statusCode).toBe(400);
    expect(r.body).toMatchObject({ success: false, code: 'TOO_EARLY' });
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it('allows a mark within 60 min of interviewStartAt', async () => {
    const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'exp@x.com', interviewStartAt: soon });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'exp@x.com', role: 'user' } }), r);
    expect(r.body.success).toBe(true);
    expect(mockUpdateOne).toHaveBeenCalled();
  });

  it('allows a mark when interviewStartAt is in the past (meeting underway)', async () => {
    const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'exp@x.com', interviewStartAt: past });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'exp@x.com', role: 'user' } }), r);
    expect(r.body.success).toBe(true);
    expect(mockUpdateOne).toHaveBeenCalled();
  });

  it('already-started + far-future stays idempotent (guard runs after the idempotency check)', async () => {
    const future = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'exp@x.com', interviewStartAt: future, meetingStarted: true, meetingStartedAt: 'T0', meetingStartedBy: 'exp@x.com' });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'exp@x.com', role: 'user' } }), r);
    expect(r.body).toMatchObject({ success: true, meetingStarted: true, meetingStartedAt: 'T0' });
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  // Legacy-time fallback: when interviewStartAt is absent, derive the schedule
  // from the legacy Eastern strings (Date of Interview + Start Time Of Interview).
  it('rejects a legacy-time mark far in the future when interviewStartAt is absent', async () => {
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'exp@x.com', 'Date of Interview': '12/31/2099', 'Start Time Of Interview': '11:00 PM' });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'exp@x.com', role: 'user' } }), r);
    expect(r.statusCode).toBe(400);
    expect(r.body).toMatchObject({ success: false, code: 'TOO_EARLY' });
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it('allows a legacy-time mark in the past (meeting already occurred)', async () => {
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'exp@x.com', 'Date of Interview': '01/01/2020', 'Start Time Of Interview': '09:00 AM' });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'exp@x.com', role: 'user' } }), r);
    expect(r.body.success).toBe(true);
    expect(mockUpdateOne).toHaveBeenCalled();
  });

  it('allows the mark when there is no schedule at all (no interviewStartAt, no legacy fields)', async () => {
    mockFindOne.mockResolvedValue({ _id: VALID_ID, assignedTo: 'exp@x.com' });
    const r = res();
    await taskController.markMeetingStarted(req({ user: { email: 'exp@x.com', role: 'user' } }), r);
    expect(r.body.success).toBe(true);
    expect(mockUpdateOne).toHaveBeenCalled();
  });
});
