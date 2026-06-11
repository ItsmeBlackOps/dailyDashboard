import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

jest.unstable_mockModule('../../config/index.js', () => ({ config: { auth: { jwtSecret: 'test-secret' } } }));
jest.unstable_mockModule('../../models/User.js', () => ({
  userModel: { getUserByEmail: (e) => ({ email: e, role: 'user', active: true, team: 'technical' }) },
}));
jest.unstable_mockModule('../../utils/logger.js', () => ({ logger: { debug: jest.fn(), warn: jest.fn() } }));
jest.unstable_mockModule('../../utils/roleAliases.js', () => ({ toLegacyRole: () => 'user' }));

const { authenticateHTTP, authenticateMeetingDetector } = await import('../auth.js');

const mockRes = () => {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const bearer = (payload) => ({ headers: { authorization: 'Bearer ' + jwt.sign(payload, 'test-secret') }, path: '/x' });

describe('scoped token isolation', () => {
  it('authenticateHTTP REJECTS a meeting-presence scoped token', () => {
    const res = mockRes();
    const next = jest.fn();
    authenticateHTTP(bearer({ email: 'e@x.com', scope: 'meeting-presence' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('authenticateHTTP ACCEPTS a normal (unscoped) token', () => {
    const req = bearer({ email: 'e@x.com' });
    const next = jest.fn();
    authenticateHTTP(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.user.email).toBe('e@x.com');
  });

  it('authenticateMeetingDetector ACCEPTS only the scoped token', () => {
    const req = bearer({ email: 'e@x.com', scope: 'meeting-presence' });
    const next = jest.fn();
    authenticateMeetingDetector(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.detectorEmail).toBe('e@x.com');
  });

  it('authenticateMeetingDetector REJECTS a normal token', () => {
    const res = mockRes();
    const next = jest.fn();
    authenticateMeetingDetector(bearer({ email: 'e@x.com' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
