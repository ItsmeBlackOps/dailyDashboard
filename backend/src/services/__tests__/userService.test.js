import { jest } from '@jest/globals';

const mockUserModel = {
  getUserByEmail: jest.fn(),
  createUser: jest.fn(),
  // C9 validator (validateTeamLeadCompatibility) reads the full roster to
  // resolve a teamLead display name back to its role/level. Without this the
  // create path throws "userModel.getAllUsers is not a function".
  getAllUsers: jest.fn()
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
        return { email: 'admin@example.com', role: 'admin', passwordHash: 'creator-hash' };
      }
      return null;
    });

    // Roster used by the C9 teamLead validator. The explicit teamLead below
    // (the admin) must resolve to an active user at an allowed level (admin).
    mockUserModel.getAllUsers.mockReturnValue([
      { email: 'admin@example.com', role: 'admin', active: true }
    ]);

    mockUserModel.createUser.mockResolvedValue({ insertedId: 'user-1' });

    const result = await userService.bulkCreateUsers(
      { email: 'admin@example.com', role: 'admin' },
      [
        {
          email: 'new.user@example.com',
          password: 'Secure123',
          role: 'user',
          // C9: an expert's teamLead must resolve to a teamLead/AM/manager/admin.
          // Point it at the admin creator so the compatibility check passes.
          teamLead: 'admin@example.com',
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
