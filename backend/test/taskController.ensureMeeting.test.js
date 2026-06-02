import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockEnsure = jest.fn();
jest.unstable_mockModule('../src/services/meetingProvisioningService.js', () => ({
  ensureMeetingForTask: mockEnsure,
  buildEventPayload: jest.fn(),
}));
jest.unstable_mockModule('../src/middleware/errorHandler.js', () => ({ asyncHandler: (fn) => fn }));
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.unstable_mockModule('../src/config/database.js', () => ({ database: { getCollection: jest.fn() } }));
jest.unstable_mockModule('../src/services/taskService.js', () => ({ taskService: {} }));
jest.unstable_mockModule('../src/services/thanksMailService.js', () => ({ thanksMailService: {} }));
jest.unstable_mockModule('../src/services/interviewerQuestionService.js', () => ({ interviewerQuestionService: {} }));
jest.unstable_mockModule('../src/services/interviewDebriefService.js', () => ({ interviewDebriefService: {} }));

const { taskController } = await import('../src/controllers/taskController.js');

function res() {
  const r = { statusCode: 200, body: undefined };
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((p) => { r.body = p; return r; });
  return r;
}
const req = (over = {}) => ({ params: { taskId: '507f1f77bcf86cd799439011' }, headers: { authorization: 'Bearer abc' }, user: { email: 'a@b.com' }, ...over });

beforeEach(() => jest.clearAllMocks());

describe('taskController.ensureMeeting', () => {
  it('201 when created', async () => {
    mockEnsure.mockResolvedValue({ status: 'created', meetingLink: 'https://teams/new' });
    const r = res();
    await taskController.ensureMeeting(req(), r);
    expect(mockEnsure).toHaveBeenCalledWith({ taskId: '507f1f77bcf86cd799439011', userAssertion: 'abc', actorEmail: 'a@b.com' });
    expect(r.statusCode).toBe(201);
    expect(r.body).toMatchObject({ created: true, meetingLink: 'https://teams/new' });
  });

  it('200 with created:false when it already exists', async () => {
    mockEnsure.mockResolvedValue({ status: 'exists', meetingLink: 'https://teams/old' });
    const r = res();
    await taskController.ensureMeeting(req(), r);
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ created: false, meetingLink: 'https://teams/old' });
  });

  it('202 when pending', async () => {
    mockEnsure.mockResolvedValue({ status: 'pending' });
    const r = res();
    await taskController.ensureMeeting(req(), r);
    expect(r.statusCode).toBe(202);
    expect(r.body).toMatchObject({ pending: true });
  });

  it('401 when no bearer token', async () => {
    const r = res();
    await taskController.ensureMeeting(req({ headers: {} }), r);
    expect(r.statusCode).toBe(401);
    expect(mockEnsure).not.toHaveBeenCalled();
  });
});
