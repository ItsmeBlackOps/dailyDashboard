import { jest } from '@jest/globals';

const findValidToken = jest.fn();

jest.unstable_mockModule('../../models/RefreshToken.js', () => ({
  refreshTokenModel: { findValidToken, saveToken: jest.fn(), deleteToken: jest.fn() },
}));
jest.unstable_mockModule('../../models/User.js', () => ({
  userModel: { getUserByEmail: jest.fn() },
}));
jest.unstable_mockModule('../../config/index.js', () => ({
  config: { auth: { jwtSecret: 'test-secret', accessTokenExpiry: '15m', refreshTokenExpiry: '7d' } },
}));
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { authService } = await import('../authService.js');

describe('refreshAccessToken with an invalid/expired token', () => {
  it('throws a 401-coded error (not a plain 500-defaulting Error)', async () => {
    findValidToken.mockResolvedValue(null);

    await expect(authService.refreshAccessToken('dead-token')).rejects.toMatchObject({
      message: 'Invalid refresh token',
      statusCode: 401,
    });
  });

  it('returns a fresh access token for a valid record', async () => {
    findValidToken.mockResolvedValue({ email: 'e@x.com' });

    const result = await authService.refreshAccessToken('good-token');
    expect(result.success).toBe(true);
    expect(typeof result.accessToken).toBe('string');
  });
});
