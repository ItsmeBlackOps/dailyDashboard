import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockGetUserByEmail = jest.fn();
const mockUpdateUser = jest.fn();
jest.unstable_mockModule('../src/models/User.js', () => ({ userModel: { getUserByEmail: mockGetUserByEmail, updateUser: mockUpdateUser } }));
jest.unstable_mockModule('../src/middleware/errorHandler.js', () => ({ asyncHandler: (fn) => fn }));
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const { userController } = await import('../src/controllers/userController.js');
const { MARKETING_MEETING_ACK } = await import('../src/config/marketingMeetingAck.js');

function res() { const r = { statusCode: 200, body: undefined }; r.status = jest.fn((c) => { r.statusCode = c; return r; }); r.json = jest.fn((p) => { r.body = p; return r; }); return r; }
beforeEach(() => jest.clearAllMocks());

describe('userController.getMyMarketingMeetingAck', () => {
  it('marketing role (recruiter) + never agreed → required', async () => {
    mockGetUserByEmail.mockReturnValue({ email: 'r@x.com' });
    const r = res();
    await userController.getMyMarketingMeetingAck({ user: { email: 'r@x.com', role: 'recruiter' } }, r);
    expect(r.body.required).toBe(true);
    expect(r.body.currentVersion).toBe(MARKETING_MEETING_ACK.version);
  });

  it('marketing role + agreed current → not required', async () => {
    mockGetUserByEmail.mockReturnValue({ email: 'r@x.com', marketingMeetingAck: { version: MARKETING_MEETING_ACK.version } });
    const r = res();
    await userController.getMyMarketingMeetingAck({ user: { email: 'r@x.com', role: 'recruiter' } }, r);
    expect(r.body.required).toBe(false);
  });

  it('non-marketing role (user/expert) → never required', async () => {
    const r = res();
    await userController.getMyMarketingMeetingAck({ user: { email: 'e@x.com', role: 'user' } }, r);
    expect(r.body.required).toBe(false);
  });
});

describe('userController.updateMyMarketingMeetingAck', () => {
  it('valid version records and returns required:false', async () => {
    mockUpdateUser.mockResolvedValue({});
    const r = res();
    await userController.updateMyMarketingMeetingAck({ user: { email: 'r@x.com', role: 'recruiter' }, body: { version: MARKETING_MEETING_ACK.version } }, r);
    expect(r.body).toMatchObject({ success: true, required: false, agreedVersion: MARKETING_MEETING_ACK.version });
    expect(mockUpdateUser).toHaveBeenCalledWith('r@x.com', expect.objectContaining({ 'marketingMeetingAck.version': MARKETING_MEETING_ACK.version, _source: 'self-marketing-meeting-ack' }));
  });

  it('missing/stale version → 400, no write', async () => {
    const r = res();
    await userController.updateMyMarketingMeetingAck({ user: { email: 'r@x.com', role: 'recruiter' }, body: { version: 999 } }, r);
    expect(r.statusCode).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});
