import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockGetUserByEmail = jest.fn();
const mockUpdateUser = jest.fn();
jest.unstable_mockModule('../src/models/User.js', () => ({ userModel: { getUserByEmail: mockGetUserByEmail, updateUser: mockUpdateUser } }));
jest.unstable_mockModule('../src/middleware/errorHandler.js', () => ({ asyncHandler: (fn) => fn }));
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const { userController } = await import('../src/controllers/userController.js');
const { MEETING_START_WARNING } = await import('../src/config/meetingStartWarning.js');

function res() { const r = { statusCode: 200, body: undefined }; r.status = jest.fn((c) => { r.statusCode = c; return r; }); r.json = jest.fn((p) => { r.body = p; return r; }); return r; }
const u = { email: 'rahul@x.com', role: 'user' };
beforeEach(() => jest.clearAllMocks());

describe('userController.getMyMeetingStartWarning', () => {
  it('armed (subdoc present, not yet dismissed) → required with content + meetings', async () => {
    mockGetUserByEmail.mockReturnValue({ email: u.email, meetingStartWarning: { shownCount: 0, dismissed: false, meetings: [{ candidate: 'Meka', scheduledEst: 'Jun 4, 2:00 PM' }] } });
    const r = res();
    await userController.getMyMeetingStartWarning({ user: u }, r);
    expect(r.body.required).toBe(true);
    expect(r.body.maxShows).toBe(MEETING_START_WARNING.maxShows);
    expect(r.body.content.title).toBe(MEETING_START_WARNING.title);
    expect(r.body.content.meetings).toHaveLength(1);
  });

  it('not armed (no subdoc) → not required, no content', async () => {
    mockGetUserByEmail.mockReturnValue({ email: u.email });
    const r = res();
    await userController.getMyMeetingStartWarning({ user: u }, r);
    expect(r.body.required).toBe(false);
    expect(r.body.content).toBeNull();
  });

  it('shownCount at maxShows → not required', async () => {
    mockGetUserByEmail.mockReturnValue({ email: u.email, meetingStartWarning: { shownCount: MEETING_START_WARNING.maxShows, dismissed: true } });
    const r = res();
    await userController.getMyMeetingStartWarning({ user: u }, r);
    expect(r.body.required).toBe(false);
  });

  it('explicitly dismissed → not required even if count < max', async () => {
    mockGetUserByEmail.mockReturnValue({ email: u.email, meetingStartWarning: { shownCount: 1, dismissed: true } });
    const r = res();
    await userController.getMyMeetingStartWarning({ user: u }, r);
    expect(r.body.required).toBe(false);
  });
});

describe('userController.acknowledgeMyMeetingStartWarning', () => {
  it('first dismissal: 0 → 1, not dismissed, still required', async () => {
    mockGetUserByEmail.mockReturnValue({ email: u.email, meetingStartWarning: { shownCount: 0, dismissed: false } });
    mockUpdateUser.mockResolvedValue({});
    const r = res();
    await userController.acknowledgeMyMeetingStartWarning({ user: u }, r);
    expect(r.body).toMatchObject({ success: true, shownCount: 1, required: true });
    expect(mockUpdateUser).toHaveBeenCalledWith(u.email, expect.objectContaining({
      'meetingStartWarning.shownCount': 1,
      'meetingStartWarning.dismissed': false,
      _source: 'self-meeting-start-warning',
    }));
  });

  it('final dismissal: 2 → 3 sets dismissed and required:false', async () => {
    mockGetUserByEmail.mockReturnValue({ email: u.email, meetingStartWarning: { shownCount: 2, dismissed: false } });
    mockUpdateUser.mockResolvedValue({});
    const r = res();
    await userController.acknowledgeMyMeetingStartWarning({ user: u }, r);
    expect(r.body).toMatchObject({ success: true, shownCount: 3, required: false });
    expect(mockUpdateUser).toHaveBeenCalledWith(u.email, expect.objectContaining({
      'meetingStartWarning.shownCount': 3,
      'meetingStartWarning.dismissed': true,
    }));
  });

  it('401 when unauthenticated', async () => {
    const r = res();
    await userController.acknowledgeMyMeetingStartWarning({ user: {} }, r);
    expect(r.statusCode).toBe(401);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});
