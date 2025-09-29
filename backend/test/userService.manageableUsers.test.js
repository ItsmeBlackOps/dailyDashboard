import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { UserService } from '../src/services/userService.js';

describe('UserService.getManageableUsers admin/manager coverage', () => {
  const service = new UserService();
  const originalUserModel = service.userModel;

  afterEach(() => {
    service.userModel = originalUserModel;
  });

  it('returns all other users for admin', async () => {
    const users = [
      { email: 'admin@example.com', role: 'admin', active: true },
      { email: 'user1@example.com', role: 'user', active: true },
      { email: 'lead1@example.com', role: 'lead', active: true },
    ];

    service.userModel = {
      getAllUsers: () => users
    };

    const result = await service.getManageableUsers({ email: 'admin@example.com', role: 'admin' });
    expect(result.success).toBe(true);
    expect(result.users).toHaveLength(2);
    const emails = result.users.map((u) => u.email).sort();
    expect(emails).toEqual(['lead1@example.com', 'user1@example.com']);
  });

  it('returns all other users for manager', async () => {
    const users = [
      { email: 'manager@example.com', role: 'manager', active: true },
      { email: 'user2@example.com', role: 'user', active: true },
      { email: 'mlead1@example.com', role: 'mlead', active: true },
    ];

    service.userModel = {
      getAllUsers: () => users
    };

    const result = await service.getManageableUsers({ email: 'manager@example.com', role: 'manager' });
    expect(result.success).toBe(true);
    expect(result.users).toHaveLength(2);
    const emails = result.users.map((u) => u.email).sort();
    expect(emails).toEqual(['mlead1@example.com', 'user2@example.com']);
  });
});

