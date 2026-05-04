import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { UserService } from '../src/services/userService.js';

const service = new UserService();
const originalUserModel = service.userModel;
const originalRefreshTokenModel = service.refreshTokenModel;

afterEach(() => {
  service.userModel = originalUserModel;
  service.refreshTokenModel = originalRefreshTokenModel;
});

describe('UserService name formatting helpers', () => {
  it('formats email inputs into display names', () => {
    expect(service.formatNameValue('rujuwal.garg@silverspaceinc.com')).toBe('Rujuwal Garg');
  });

  it('trims and collapses whitespace in provided names', () => {
    expect(service.formatNameValue('  Harsh    Patel  ')).toBe('Harsh Patel');
  });

  it('defaults marketing lead reporting chain to the new lead name when assistant manager creates one', () => {
    const newLeadEmail = 'sachin.jain@vizvainc.com';

    const teamLead = service.resolveTeamLeadForCreation(
      { email: 'brhamdev.sharma@vizvainc.com', role: 'MAM' },
      'mlead',
      '',
      newLeadEmail
    );

    const manager = service.resolveManagerForCreation(
      { email: 'brhamdev.sharma@vizvainc.com', role: 'MAM' },
      'mlead',
      '',
      { manager: 'tushar.ahuja@silverspaceinc.com' },
      newLeadEmail
    );

    expect(teamLead).toBe('Sachin Jain');
    expect(manager).toBe('Sachin Jain');
  });

  it('falls back to requester manager for assistant managers', () => {
    const result = service.resolveManagerForCreation(
      { email: 'brhamdev.sharma@vizvainc.com', role: 'MAM' },
      'recruiter',
      '',
      { manager: 'tushar.ahuja@silverspaceinc.com' },
      'akash.gautam@vizvainc.com'
    );

    expect(result).toBe('Tushar Ahuja');
  });

  it('reuses stored manager when marketing lead creates a recruiter', () => {
    const result = service.resolveManagerForCreation(
      { email: 'rajat.verma@vizvainc.com', role: 'mlead' },
      'recruiter',
      '',
      { manager: 'Raghav Sharma' },
      'anita.mehra@vizvainc.com'
    );

    expect(result).toBe('Raghav Sharma');
  });

  it('defaults marketing lead as team lead for recruiter creation', () => {
    const value = service.resolveTeamLeadForCreation(
      { email: 'rajat.verma@vizvainc.com', role: 'mlead' },
      'recruiter',
      '',
      'anita.mehra@vizvainc.com'
    );

    expect(value).toBe('Rajat Verma');
  });

  it('defaults lead as team lead when creating users', () => {
    const value = service.resolveTeamLeadForCreation(
      { email: 'jyoti.kapoor@vizvainc.com', role: 'lead' },
      'user',
      ''
    );

    expect(value).toBe('Jyoti Kapoor');
  });

  it('normalizes provided team lead values from emails when creating users', () => {
    const value = service.resolveTeamLeadForCreation(
      { email: 'brhamdev.sharma@vizvainc.com', role: 'MAM' },
      'recruiter',
      'prateek.narvariya@silverspaceinc.com',
      'riya.sharma@vizvainc.com'
    );

    expect(value).toBe('Prateek Narvariya');
  });
});

describe('UserService bulk update defaults', () => {
  it('applies marketing lead defaults when promoting a recruiter to mlead', async () => {
    const updateUser = jest.fn().mockResolvedValue(null);
    const getUserByEmail = jest.fn().mockReturnValue({
      email: 'suraj.bohra@vizvainc.com',
      role: 'recruiter',
      teamLead: '',
      manager: ''
    });
    const revokeTokens = jest.fn().mockResolvedValue(null);

    service.userModel = {
      getUserByEmail,
      updateUser,
      getAllUsers: jest.fn().mockReturnValue([{ email: 'suraj.bohra@vizvainc.com', role: 'mam' }])
    };

    service.refreshTokenModel = {
      revokeAllTokensForUser: revokeTokens
    };

    const result = await service.bulkUpdateUsers(
      { email: 'brhamdev.sharma@vizvainc.com', role: 'MAM' },
      [{ email: 'suraj.bohra@vizvainc.com', role: 'mlead' }]
    );

    expect(result.success).toBe(true);
    expect(updateUser).toHaveBeenCalledWith(
      'suraj.bohra@vizvainc.com',
      expect.objectContaining({
        role: 'mlead',
        teamLead: 'Suraj Bohra',
        manager: 'Suraj Bohra'
      })
    );
    expect(revokeTokens).toHaveBeenCalledWith('suraj.bohra@vizvainc.com');
  });

  it('applies lead defaults when updating direct reports', async () => {
    const updateUser = jest.fn().mockResolvedValue(null);
    const getUserByEmail = jest.fn().mockReturnValue({
      email: 'team.member@vizvainc.com',
      role: 'user',
      teamLead: '',
      manager: ''
    });
    const revokeTokens = jest.fn().mockResolvedValue(null);

    service.userModel = {
      getUserByEmail,
      updateUser,
      getAllUsers: jest.fn().mockReturnValue([{ email: 'lead.user@vizvainc.com', role: 'lead' }])
    };

    service.refreshTokenModel = {
      revokeAllTokensForUser: revokeTokens
    };

    const result = await service.bulkUpdateUsers(
      { email: 'lead.user@vizvainc.com', role: 'lead' },
      [{ email: 'team.member@vizvainc.com' }]
    );

    expect(result.success).toBe(true);
    expect(updateUser).toHaveBeenCalledWith(
      'team.member@vizvainc.com',
      expect.objectContaining({
        teamLead: 'Lead User',
        manager: 'Lead User'
      })
    );
  });
});

describe('UserService permission checks', () => {
  it('allows marketing lead to create recruiters', () => {
    expect(service.canCreateRole('mlead', 'recruiter')).toBe(true);
    expect(service.canCreateRole('mlead', 'MAM')).toBe(false);
  });

  it('allows lead to create users only', () => {
    expect(service.canCreateRole('lead', 'user')).toBe(true);
    expect(service.canCreateRole('lead', 'recruiter')).toBe(false);
  });

  it('allows MM to reassign direct reports to allowed roles during bulk update', async () => {
    const updateUser = jest.fn().mockResolvedValue(null);
    const getUserByEmail = jest.fn().mockReturnValue({
      email: 'neha.singh@vizvainc.com',
      role: 'recruiter',
      teamLead: 'Existing Lead',
      manager: 'Existing Manager'
    });
    const revokeTokens = jest.fn().mockResolvedValue(null);

    service.userModel = {
      getUserByEmail,
      updateUser,
      getAllUsers: jest.fn().mockReturnValue([{ email: 'neha.singh@vizvainc.com', role: 'mam' }])
    };

    service.refreshTokenModel = {
      revokeAllTokensForUser: revokeTokens
    };

    const result = await service.bulkUpdateUsers(
      { email: 'sukhdeep.saxena@vizvainc.com', role: 'MM' },
      [{ email: 'neha.singh@vizvainc.com', role: 'mlead' }]
    );

    expect(result.success).toBe(true);
    expect(updateUser).toHaveBeenCalledWith(
      'neha.singh@vizvainc.com',
      expect.objectContaining({ role: 'mlead' })
    );
  });

  it('prevents MM from assigning unsupported roles during bulk update', async () => {
    const updateUser = jest.fn();
    const getUserByEmail = jest.fn().mockReturnValue({
      email: 'neha.singh@vizvainc.com',
      role: 'recruiter',
      teamLead: 'Existing Lead',
      manager: 'Existing Manager'
    });
    const revokeTokens = jest.fn();

    service.userModel = {
      getUserByEmail,
      updateUser
    };

    service.refreshTokenModel = {
      revokeAllTokensForUser: revokeTokens
    };

    const result = await service.bulkUpdateUsers(
      { email: 'sukhdeep.saxena@vizvainc.com', role: 'MM' },
      [{ email: 'neha.singh@vizvainc.com', role: 'admin' }]
    );

    expect(result.success).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].error).toBe('Not allowed to assign this role');
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe('UserService MM hierarchy rules', () => {
  it('allows MM to bulk create MAM without specifying team lead', async () => {
    const createUser = jest.fn().mockResolvedValue(null);
    const getUserByEmail = jest
      .fn()
      .mockImplementation((email) => {
        if (email === 'neha.malik@silverspaceinc.com') {
          return { email, role: 'MM' };
        }
        return null;
      });

    service.userModel = {
      getUserByEmail,
      createUser
    };

    const result = await service.bulkCreateUsers(
      { email: 'neha.malik@silverspaceinc.com', role: 'MM' },
      [{ email: 'priya.singh@vizvainc.com', password: 'secret1', role: 'MAM' }]
    );

    expect(result.success).toBe(true);
    expect(createUser).toHaveBeenCalledWith({
      email: 'priya.singh@vizvainc.com',
      password: 'secret1',
      adminHash: null,
      role: 'mam',
      teamLead: '',
      manager: 'Neha Malik',
      active: true
    });
  });

  it('prevents MM from creating recruiters directly', async () => {
    const getUserByEmail = jest.fn().mockImplementation((email) => {
      if (email === 'neha.malik@silverspaceinc.com') {
        return { email, role: 'MM' };
      }
      return null;
    });

    service.userModel = {
      getUserByEmail,
      createUser: jest.fn()
    };

    const result = await service.bulkCreateUsers(
      { email: 'neha.malik@silverspaceinc.com', role: 'MM' },
      [{ email: 'recruit.new@vizvainc.com', password: 'secret1', role: 'recruiter' }]
    );

    expect(result.success).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].error).toBe('Not allowed to create this role');
  });

  it('fills manager automatically when MM updates a MAM', async () => {
    const updateUser = jest.fn().mockResolvedValue(null);
    const getUserByEmail = jest.fn().mockReturnValue({
      email: 'priya.singh@vizvainc.com',
      role: 'MAM',
      teamLead: '',
      manager: ''
    });
    const revokeTokens = jest.fn().mockResolvedValue(null);

    service.userModel = {
      getUserByEmail,
      updateUser
    };

    service.refreshTokenModel = {
      revokeAllTokensForUser: revokeTokens
    };

    const result = await service.bulkUpdateUsers(
      { email: 'neha.malik@silverspaceinc.com', role: 'MM' },
      [{ email: 'priya.singh@vizvainc.com' }]
    );

    expect(result.success).toBe(true);
    expect(updateUser).toHaveBeenCalledWith(
      'priya.singh@vizvainc.com',
      expect.objectContaining({ manager: 'Neha Malik' })
    );
    expect(updateUser.mock.calls[0][1]).not.toHaveProperty('teamLead');
  });

  it('uses marketing lead dropdown values when MM updates recruiters', async () => {
    const updateUser = jest.fn().mockResolvedValue(null);
    const getUserByEmail = jest.fn().mockReturnValue({
      email: 'recruit.one@vizvainc.com',
      role: 'recruiter',
      teamLead: 'Existing Lead',
      manager: 'Existing Manager'
    });
    const revokeTokens = jest.fn().mockResolvedValue(null);

    service.userModel = {
      getUserByEmail,
      updateUser,
      getAllUsers: jest.fn().mockReturnValue([{ email: 'existing.lead@example.com', role: 'mlead' }])
    };

    service.refreshTokenModel = {
      revokeAllTokensForUser: revokeTokens
    };

    const result = await service.bulkUpdateUsers(
      { email: 'neha.malik@silverspaceinc.com', role: 'MM' },
      [{ email: 'recruit.one@vizvainc.com' }]
    );

    expect(result.success).toBe(true);
    expect(updateUser).toHaveBeenCalledWith(
      'recruit.one@vizvainc.com',
      expect.objectContaining({
        teamLead: 'Existing Lead',
        manager: 'Neha Malik'
      })
    );
  });
});
