import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { UserService } from '../src/services/userService.js';

const service = new UserService();
const originalUserModel = service.userModel;
const originalRefreshTokenModel = service.refreshTokenModel;

afterEach(() => {
  service.userModel = originalUserModel;
  service.refreshTokenModel = originalRefreshTokenModel;
  jest.restoreAllMocks();
});

describe('UserService.updateUserPassword', () => {
  it('allows a user to update their own password and revokes sessions', async () => {
    const updateUser = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const getUserByEmail = jest.fn().mockReturnValue({ email: 'user@example.com' });
    const revokeTokens = jest.fn().mockResolvedValue(2);

    service.userModel = {
      getUserByEmail,
      updateUser
    };

    service.refreshTokenModel = {
      revokeAllTokensForUser: revokeTokens
    };

    const result = await service.updateUserPassword(
      'user@example.com',
      'NewPass123',
      'user@example.com',
      'user'
    );

    expect(result.success).toBe(true);
    expect(updateUser).toHaveBeenCalledWith('user@example.com', { password: 'NewPass123' });
    expect(revokeTokens).toHaveBeenCalledWith('user@example.com');
  });

  it('prevents unauthorized password updates on other accounts', async () => {
    const getUserByEmail = jest.fn().mockReturnValue({ email: 'target@example.com' });

    service.userModel = {
      getUserByEmail
    };

    await expect(
      service.updateUserPassword(
        'target@example.com',
        'NewPass123',
        'another@example.com',
        'user'
      )
    ).rejects.toThrow('Insufficient permissions');
  });

  it('allows admins to reset another user password', async () => {
    const updateUser = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const getUserByEmail = jest.fn().mockReturnValue({ email: 'target@example.com' });
    const revokeTokens = jest.fn().mockResolvedValue(1);

    service.userModel = {
      getUserByEmail,
      updateUser
    };

    service.refreshTokenModel = {
      revokeAllTokensForUser: revokeTokens
    };

    const result = await service.updateUserPassword(
      'target@example.com',
      'StrongPass9',
      'admin@example.com',
      'admin'
    );

    expect(result.success).toBe(true);
    expect(updateUser).toHaveBeenCalledWith('target@example.com', { password: 'StrongPass9' });
    expect(revokeTokens).toHaveBeenCalledWith('target@example.com');
  });

  it('validates password strength requirements', async () => {
    const getUserByEmail = jest.fn().mockReturnValue({ email: 'user@example.com' });

    service.userModel = {
      getUserByEmail
    };

    await expect(
      service.updateUserPassword('user@example.com', 'weak', 'user@example.com', 'user')
    ).rejects.toThrow('Password must be at least 8 characters');
  });
});
