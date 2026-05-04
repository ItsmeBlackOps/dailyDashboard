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

  it('returns manageable users for mm', async () => {
    const users = [
      { email: 'manager@example.com', role: 'mm', active: true },
      { email: 'user2@example.com', role: 'recruiter', teamLead: 'Manager', active: true },
      { email: 'mlead1@example.com', role: 'mlead', teamLead: 'Manager', active: true },
    ];

    service.userModel = {
      getAllUsers: () => users
    };

    const result = await service.getManageableUsers({ email: 'manager@example.com', role: 'mm' });
    expect(result.success).toBe(true);
    expect(result.users).toHaveLength(2);
    const emails = result.users.map((u) => u.email).sort();
    expect(emails).toEqual(['mlead1@example.com', 'user2@example.com']);
  });

  it('builds hierarchy scope with self + manageable aliases', () => {
    const users = [
      { email: 'mam.user@example.com', role: 'mam', teamLead: '', manager: '', active: true },
      { email: 'mlead.one@example.com', role: 'mlead', teamLead: 'Mam User', manager: '', active: true },
      { email: 'recruiter.one@example.com', role: 'recruiter', teamLead: 'Mlead One', manager: '', active: true }
    ];

    service.userModel = {
      getAllUsers: () => users
    };

    const scope = service.buildTaskHierarchyScope({
      email: 'mam.user@example.com',
      role: 'mam'
    });

    expect(scope.emails).toEqual([
      'mam.user@example.com',
      'mlead.one@example.com',
      'recruiter.one@example.com'
    ]);
    expect(scope.locals).toEqual(
      expect.arrayContaining(['mam.user', 'mlead.one', 'recruiter.one'])
    );
    expect(scope.displayNames).toEqual(
      expect.arrayContaining(['mam user', 'mlead one', 'recruiter one'])
    );
    expect(scope.escaped.emails).toEqual(
      expect.arrayContaining(['mam\\.user@example\\.com', 'mlead\\.one@example\\.com'])
    );
  });
});

