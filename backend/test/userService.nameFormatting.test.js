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
      updateUser
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
      // C9 validator resolves the auto-assigned teamLead ('Lead User')
      // back to a role/level via the roster; the requesting lead must
      // appear so the expert report's lead resolves to teamLead level.
      getAllUsers: () => [
        { email: 'lead.user@vizvainc.com', role: 'lead', active: true }
      ]
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
      updateUser
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
      createUser,
      // C9 validator reads the roster; an empty MAM teamLead short-circuits
      // to valid, but getAllUsers must still be a function.
      getAllUsers: () => []
    };

    const result = await service.bulkCreateUsers(
      { email: 'neha.malik@silverspaceinc.com', role: 'MM' },
      [{ email: 'priya.singh@vizvainc.com', password: 'secret1', role: 'MAM' }]
    );

    expect(result.success).toBe(true);
    // C20: the role is normalised to its canonical lowercase form (`mam`) and
    // a `team` field is now persisted (null here — MM creator has no team in
    // this fixture, so the new user inherits none).
    expect(createUser).toHaveBeenCalledWith({
      email: 'priya.singh@vizvainc.com',
      password: 'secret1',
      adminHash: null,
      role: 'mam',
      team: null,
      teamLead: '',
      manager: 'Neha Malik',
      active: true
    });
  });

  it('allows MM to create recruiters directly (C20 broadened mm create scope)', async () => {
    // Pre-C20, `canCreateRole('mm', ...)` allowed only `['mam']`, so this case
    // was a rejection. The C20 role-rename (PR #101) broadened mm/manager to
    // `['mam','mlead','recruiter','assistantManager','teamLead']` — documented
    // in CLAUDE.md §3 and the canCreateRole comment — so an MM may now create a
    // recruiter directly. The "MM cannot assign an unsupported role" path is
    // still covered by the sibling bulk-update test that rejects `admin`.
    const createUser = jest.fn().mockResolvedValue(null);
    const getUserByEmail = jest.fn().mockImplementation((email) => {
      if (email === 'neha.malik@silverspaceinc.com') {
        return { email, role: 'MM' };
      }
      return null;
    });

    service.userModel = {
      getUserByEmail,
      createUser,
      // C9 validator resolves the derived teamLead ('Neha Malik') back to a
      // role/level; the MM requester must appear in the roster at mm level.
      getAllUsers: () => [
        { email: 'neha.malik@silverspaceinc.com', role: 'mm', active: true }
      ]
    };

    const result = await service.bulkCreateUsers(
      { email: 'neha.malik@silverspaceinc.com', role: 'MM' },
      [{ email: 'recruit.new@vizvainc.com', password: 'secret1', role: 'recruiter' }]
    );

    expect(result.success).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'recruit.new@vizvainc.com', role: 'recruiter' })
    );
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
      // C9 validator resolves the preserved teamLead ('Existing Lead') back to
      // a role/level. The recruiter's lead must resolve to an active user at
      // teamLead/AM/manager/admin level, so the roster includes existing.lead
      // (a MAM) plus the MM requester.
      getAllUsers: () => [
        { email: 'recruit.one@vizvainc.com', role: 'recruiter', active: true },
        { email: 'existing.lead@vizvainc.com', role: 'mam', active: true },
        { email: 'neha.malik@silverspaceinc.com', role: 'mm', active: true }
      ]
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
