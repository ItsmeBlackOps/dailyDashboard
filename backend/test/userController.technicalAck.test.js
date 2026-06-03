import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockGetUserByEmail = jest.fn();
const mockUpdateUser = jest.fn();
jest.unstable_mockModule('../src/models/User.js', () => ({ userModel: { getUserByEmail: mockGetUserByEmail, updateUser: mockUpdateUser } }));
jest.unstable_mockModule('../src/middleware/errorHandler.js', () => ({ asyncHandler: (fn) => fn }));
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const { userController } = await import('../src/controllers/userController.js');
const { TECHNICAL_ACK } = await import('../src/config/technicalAck.js');

function res() { const r = { statusCode: 200, body: undefined }; r.status = jest.fn((c) => { r.statusCode = c; return r; }); r.json = jest.fn((p) => { r.body = p; return r; }); return r; }
beforeEach(() => jest.clearAllMocks());

describe('userController.getMyTechnicalAck', () => {
  it('technical role + never agreed → required with content', async () => {
    mockGetUserByEmail.mockReturnValue({ email: 'e@x.com' });
    const r = res();
    await userController.getMyTechnicalAck({ user: { email: 'e@x.com', role: 'user' } }, r);
    expect(r.body.required).toBe(true);
    expect(r.body.content.version).toBe(TECHNICAL_ACK.version);
  });

  it('technical role + agreed current → not required, no content', async () => {
    mockGetUserByEmail.mockReturnValue({ email: 'e@x.com', technicalAck: { version: TECHNICAL_ACK.version } });
    const r = res();
    await userController.getMyTechnicalAck({ user: { email: 'e@x.com', role: 'am' } }, r);
    expect(r.body.required).toBe(false);
    expect(r.body.content).toBeNull();
  });

  it('non-technical role → never required', async () => {
    const r = res();
    await userController.getMyTechnicalAck({ user: { email: 'm@x.com', role: 'recruiter' } }, r);
    expect(r.body.required).toBe(false);
  });
});

describe('userController.updateMyTechnicalAck', () => {
  it('valid version records and returns required:false', async () => {
    mockUpdateUser.mockResolvedValue({});
    const r = res();
    await userController.updateMyTechnicalAck({ user: { email: 'e@x.com', role: 'user' }, body: { version: TECHNICAL_ACK.version } }, r);
    expect(r.body).toMatchObject({ success: true, required: false, agreedVersion: TECHNICAL_ACK.version });
    expect(mockUpdateUser).toHaveBeenCalledWith('e@x.com', expect.objectContaining({ 'technicalAck.version': TECHNICAL_ACK.version, _source: 'self-technical-ack' }));
  });

  it('missing/stale version → 400, no write', async () => {
    const r = res();
    await userController.updateMyTechnicalAck({ user: { email: 'e@x.com', role: 'user' }, body: { version: 999 } }, r);
    expect(r.statusCode).toBe(400);
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});
