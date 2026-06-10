import { jest } from '@jest/globals';

const mockUserModel = {
  getUserByEmail: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
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

describe('userService.bulkUpdateUsers — promote to team lead', () => {
  // Roster mirrors the real production records that triggered the bug:
  // Prateek (recruiter, marketing) whose teamLead "Avinash Mishra" is itself
  // a teamLead (too junior to be a teamLead's superior) and whose manager is
  // "Aryan Mishra" (a manager — a VALID superior). Names are derived from the
  // emails by the service, so the email local-parts must produce them.
  const ROSTER = [
    { email: 'aryan.mishra@example.com', role: 'manager', team: 'marketing', active: true },
    { email: 'avinash.mishra@example.com', role: 'teamLead', team: 'marketing', active: true },
    { email: 'prateek.dwivedi@example.com', role: 'recruiter', team: 'marketing', active: true },
    { email: 'super.admin@example.com', role: 'admin', active: true }
  ];

  const PRATEEK = {
    email: 'prateek.dwivedi@example.com',
    role: 'recruiter',
    team: 'marketing',
    teamLead: 'Avinash Mishra',
    manager: 'Aryan Mishra',
    active: true
  };

  const wireRoster = (extra = {}) => {
    mockUserModel.getAllUsers.mockReturnValue(ROSTER);
    mockUserModel.getUserByEmail.mockImplementation((email) => {
      if (email === 'prateek.dwivedi@example.com') return { ...PRATEEK };
      if (email === 'aryan.mishra@example.com') return { email, role: 'manager', team: 'marketing' };
      if (email === 'super.admin@example.com') return { email, role: 'admin' };
      return null;
    });
    mockUserModel.updateUser.mockResolvedValue({});
    mockRefreshTokenModel.revokeAllTokensForUser.mockResolvedValue();
    return extra;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('assigns the target\'s real manager (not self) as the new lead\'s teamLead/manager when a MANAGER promotes', async () => {
    wireRoster();

    const result = await userService.bulkUpdateUsers(
      { email: 'aryan.mishra@example.com', role: 'manager' },
      [{ email: 'prateek.dwivedi@example.com', role: 'teamLead' }]
    );

    expect(result.failures).toEqual([]);
    expect(mockUserModel.updateUser).toHaveBeenCalledWith(
      'prateek.dwivedi@example.com',
      expect.objectContaining({
        role: 'teamLead',
        teamLead: 'Aryan Mishra',
        manager: 'Aryan Mishra'
      })
    );
    // Must NOT self-reference — that is the self-loop the C16 model validator rejects.
    const payload = mockUserModel.updateUser.mock.calls.at(-1)[1];
    expect(payload.teamLead).not.toBe('Prateek Dwivedi');
    expect(payload.manager).not.toBe('Prateek Dwivedi');
  });

  it('resolves the superior from the target\'s record (Aryan), NOT the clicker, when an ADMIN promotes', async () => {
    wireRoster();

    const result = await userService.bulkUpdateUsers(
      { email: 'super.admin@example.com', role: 'admin' },
      [{ email: 'prateek.dwivedi@example.com', role: 'teamLead' }]
    );

    expect(result.failures).toEqual([]);
    const payload = mockUserModel.updateUser.mock.calls.at(-1)[1];
    expect(payload.role).toBe('teamLead');
    // The promoting admin must NOT become Prateek's superior — Aryan must.
    expect(payload.teamLead).toBe('Aryan Mishra');
    expect(payload.manager).toBe('Aryan Mishra');
    expect(payload.teamLead).not.toBe('Super Admin');
    expect(payload.teamLead).not.toBe('Prateek Dwivedi');
  });
});
