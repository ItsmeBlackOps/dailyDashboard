import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// updateMeetingLink is the endpoint the one-meeting flow PATCHes. It must keep
// joinUrl/joinWebUrl in sync with meetingLink so the TasksToday Join/Create
// button (which reads joinUrl/joinWebUrl) reflects a created meeting on reload.

const mockFindOneAndUpdate = jest.fn();
const mockGetCollection = jest.fn(() => ({ findOneAndUpdate: mockFindOneAndUpdate }));

jest.unstable_mockModule('../src/config/database.js', () => ({
  database: { getCollection: mockGetCollection }
}));
jest.unstable_mockModule('../src/middleware/errorHandler.js', () => ({
  asyncHandler: (fn) => fn
}));
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
mockLogger.child = jest.fn(() => mockLogger);
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: mockLogger
}));
// Heavy service deps imported by taskController but unused by updateMeetingLink.
jest.unstable_mockModule('../src/services/taskService.js', () => ({ taskService: {} }));
jest.unstable_mockModule('../src/services/thanksMailService.js', () => ({ thanksMailService: {} }));
jest.unstable_mockModule('../src/services/interviewerQuestionService.js', () => ({ interviewerQuestionService: {} }));
jest.unstable_mockModule('../src/services/interviewDebriefService.js', () => ({ interviewDebriefService: {} }));

const { taskController } = await import('../src/controllers/taskController.js');

function createMockResponse() {
  const res = { statusCode: 200, body: undefined };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.body = payload; return res; });
  return res;
}

const VALID_ID = '507f1f77bcf86cd799439011';

describe('taskController.updateMeetingLink', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOneAndUpdate.mockResolvedValue({ _id: VALID_ID, meetingLink: 'set' });
  });

  it('persists joinUrl and joinWebUrl in sync with meetingLink', async () => {
    const link = 'https://teams.microsoft.com/l/meetup-join/abc';
    const req = { params: { taskId: VALID_ID }, body: { meetingLink: link } };
    const res = createMockResponse();

    await taskController.updateMeetingLink(req, res);

    expect(mockFindOneAndUpdate).toHaveBeenCalledTimes(1);
    const [, updateDoc] = mockFindOneAndUpdate.mock.calls[0];
    expect(updateDoc.$set.meetingLink).toBe(link);
    expect(updateDoc.$set.joinUrl).toBe(link);
    expect(updateDoc.$set.joinWebUrl).toBe(link);
    expect(mockFindOneAndUpdate.mock.calls[0][2]).toEqual(
      expect.objectContaining({ projection: { replies: 0, body: 0 } })
    );
    expect(res.body).toMatchObject({ success: true });
  });

  it('clears joinUrl/joinWebUrl when the meeting link is removed', async () => {
    const req = { params: { taskId: VALID_ID }, body: { meetingLink: '' } };
    const res = createMockResponse();

    await taskController.updateMeetingLink(req, res);

    const [, updateDoc] = mockFindOneAndUpdate.mock.calls[0];
    expect(updateDoc.$set.meetingLink).toBeNull();
    expect(updateDoc.$set.joinUrl).toBeNull();
    expect(updateDoc.$set.joinWebUrl).toBeNull();
  });

  it('rejects an invalid taskId with 400 and never writes', async () => {
    const req = { params: { taskId: 'not-an-objectid' }, body: { meetingLink: 'x' } };
    const res = createMockResponse();

    await taskController.updateMeetingLink(req, res);

    expect(res.statusCode).toBe(400);
    expect(mockFindOneAndUpdate).not.toHaveBeenCalled();
  });
});
