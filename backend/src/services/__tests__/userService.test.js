import { jest } from '@jest/globals';

const mockUserModel = {
  getUserByEmail: jest.fn(),
  createUser: jest.fn()
};

const mockRefreshTokenModel = {
  revokeAllTokensForUser: jest.fn()
};

jest.unstable_mockModule('../../models/User.js', () => ({
  userModel: mockUserModel
}));

jest.unstable_mockModule('../../models/RefreshToken.js', () => ({
  refreshTokenModel: mockRefreshTokenModel
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

const { userService } = await import('../userService.js');

describe('userService.bulkCreateUsers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores creator password hash as adminHash for new users', async () => {
    mockUserModel.getUserByEmail.mockImplementation((email) => {
      if (email === 'admin@example.com') {
        return { passwordHash: 'creator-hash' };
      }
      return null;
    });

    mockUserModel.createUser.mockResolvedValue({ insertedId: 'user-1' });

    const result = await userService.bulkCreateUsers(
      { email: 'admin@example.com', role: 'admin' },
      [
        {
          email: 'new.user@example.com',
          password: 'Secure123',
          role: 'user',
          active: true
        }
      ]
    );

    expect(result.success).toBe(true);
    expect(mockUserModel.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new.user@example.com',
        adminHash: 'creator-hash'
      })
    );
  });
});
