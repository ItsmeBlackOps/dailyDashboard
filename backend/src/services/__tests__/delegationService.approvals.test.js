import { jest } from '@jest/globals';

// ── collection mocks, keyed by name ────────────────────────────────────
const delegCol = {
  insertOne: jest.fn(async () => ({ insertedId: { toString: () => 'd1' } })),
  findOne: jest.fn(),
  updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
  find: jest.fn(() => ({ toArray: async () => [] })),
  createIndex: jest.fn(),
};
const usersToArray = jest.fn(async () => []);
const usersCol = { find: jest.fn(() => ({ toArray: usersToArray })) };
const taskToArray = jest.fn(async () => []);
const taskCol = { find: jest.fn(() => ({ toArray: taskToArray })) };

jest.unstable_mockModule('../../config/database.js', () => ({
  database: {
    getCollection: (name) => {
      if (name === 'userDelegations') return delegCol;
      if (name === 'users') return usersCol;
      if (name === 'taskBody') return taskCol;
      return null;
    },
  },
}));

const getUserByEmail = jest.fn();
jest.unstable_mockModule('../../models/User.js', () => ({
  userModel: { getUserByEmail },
}));

const createNotification = jest.fn(async () => ({}));
jest.unstable_mockModule('../notificationService.js', () => ({
  notificationService: {
    createNotification,
    broadcastToWatchers: jest.fn(async () => ({})),
  },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Lazy-imported by grant()/eligibleOptions()/resolveTeamLeadEmail.
jest.unstable_mockModule('../userService.js', () => ({
  userService: {
    deriveDisplayNameFromEmail: (email) => {
      const local = (email || '').split('@')[0];
      return local
        .split(/[._]/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');
    },
    formatNameValue: (v) => v,
  },
}));

const { delegationService } = await import('../delegationService.js');

const SUBHASH = {
  email: 'subhash.sharma@vizvainc.com', role: 'expert', team: 'technical',
  teamLead: 'Anusree Vasudevan', active: true,
};
const UTSA = {
  email: 'utsa.maiti@vizvainc.com', role: 'expert', team: 'technical',
  teamLead: 'Anusree Vasudevan', active: true,
};
const ANUSREE = {
  email: 'anusree.vasudevan@vizvainc.com', role: 'teamLead', team: 'technical',
  teamLead: null, active: true,
};

const wireUsers = () => {
  getUserByEmail.mockImplementation((email) => {
    const e = (email || '').toLowerCase();
    if (e === SUBHASH.email) return SUBHASH;
    if (e === UTSA.email) return UTSA;
    if (e === ANUSREE.email) return ANUSREE;
    return null;
  });
  // users collection — used by resolveTeamLeadEmail + eligibleOptions
  usersToArray.mockResolvedValue([SUBHASH, UTSA, ANUSREE]);
};

beforeEach(() => {
  jest.clearAllMocks();
  wireUsers();
});

const TASK_ID = '6a2c0c5aedd160ce6e3b3e42';

describe('expert-authored grants → pending + approval', () => {
  it('a task hand-off lands pending with the expert\'s lead as approver, expiring after the last task', async () => {
    // Relative to now — the service clamps expiry to max(taskEnd, now)+24h,
    // so a fixed past date asserts the wrong branch once the clock passes
    // it (exactly how this test broke in CI).
    const taskEnd = new Date(Date.now() + 2 * 3600 * 1000);
    taskToArray.mockResolvedValue([
      { _id: TASK_ID, assignedTo: SUBHASH.email, interviewEndsAt: taskEnd },
    ]);

    const doc = await delegationService.grant(
      { email: SUBHASH.email, role: 'expert', team: 'technical' },
      { ownerEmail: SUBHASH.email, delegateEmail: UTSA.email, scope: 'tasks', taskIds: [TASK_ID] }
    );

    expect(doc.status).toBe('pending');
    expect(doc.approverEmail).toBe(ANUSREE.email);
    expect(doc.taskIds).toEqual([TASK_ID]);
    expect(doc.expiresAt.getTime()).toBe(taskEnd.getTime() + 24 * 3600 * 1000);
    // approver got the heads-up
    expect(createNotification).toHaveBeenCalledWith(
      ANUSREE.email,
      expect.objectContaining({ title: 'Delegation approval needed' })
    );
  });

  it('a dashboard window requires endsAt, caps at 30 days, and respects startsAt', async () => {
    await expect(
      delegationService.grant(
        { email: SUBHASH.email, role: 'expert', team: 'technical' },
        { ownerEmail: SUBHASH.email, delegateEmail: UTSA.email, scope: 'subtree', subtreeRootEmail: SUBHASH.email }
      )
    ).rejects.toThrow(/needs an end date/);

    await expect(
      delegationService.grant(
        { email: SUBHASH.email, role: 'expert', team: 'technical' },
        {
          ownerEmail: SUBHASH.email, delegateEmail: UTSA.email, scope: 'subtree',
          subtreeRootEmail: SUBHASH.email,
          startsAt: '2026-06-15T00:00:00Z', endsAt: '2026-08-30T00:00:00Z',
        }
      )
    ).rejects.toThrow(/cannot exceed 30 days/);

    const doc = await delegationService.grant(
      { email: SUBHASH.email, role: 'expert', team: 'technical' },
      {
        ownerEmail: SUBHASH.email, delegateEmail: UTSA.email, scope: 'subtree',
        subtreeRootEmail: SUBHASH.email,
        startsAt: '2026-06-15T00:00:00Z', endsAt: '2026-06-22T00:00:00Z',
      }
    );
    expect(doc.status).toBe('pending');
    expect(doc.startsAt.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(doc.expiresAt.toISOString()).toBe('2026-06-22T00:00:00.000Z');
  });

  it('experts cannot share an arbitrary subtree or use specific scope', async () => {
    await expect(
      delegationService.grant(
        { email: SUBHASH.email, role: 'expert', team: 'technical' },
        { ownerEmail: SUBHASH.email, delegateEmail: UTSA.email, scope: 'subtree', subtreeRootEmail: ANUSREE.email }
      )
    ).rejects.toThrow(/own dashboard/);

    await expect(
      delegationService.grant(
        { email: SUBHASH.email, role: 'expert', team: 'technical' },
        { ownerEmail: SUBHASH.email, delegateEmail: UTSA.email, scope: 'specific', subjectEmails: ['x@y.com'] }
      )
    ).rejects.toThrow(/share matrix violation|experts can share/);
  });

  it('caps task hand-offs at 10 tasks', async () => {
    const many = Array.from({ length: 11 }, () => TASK_ID);
    await expect(
      delegationService.grant(
        { email: SUBHASH.email, role: 'expert', team: 'technical' },
        { ownerEmail: SUBHASH.email, delegateEmail: UTSA.email, scope: 'tasks', taskIds: many }
      )
    ).rejects.toThrow(/at most 10/);
  });

  it('the expert\'s own lead hands off on their behalf with NO approval step', async () => {
    const doc = await delegationService.grant(
      { email: ANUSREE.email, role: 'lead', team: 'technical' },
      { ownerEmail: SUBHASH.email, delegateEmail: UTSA.email, scope: 'day', dayDate: '2026-06-13' }
    );
    expect(doc.status).toBe('active');
    expect(doc.approverEmail).toBeNull();
    expect(doc.dayDate).toBe('2026-06-13');
  });
});

describe('approve / reject', () => {
  const PENDING = {
    _id: 'd1', status: 'pending',
    ownerEmail: SUBHASH.email, delegateEmail: UTSA.email,
    approverEmail: ANUSREE.email, scope: 'day', dayDate: '2026-06-13', taskIds: [],
  };

  it('the assigned approver activates the request', async () => {
    delegCol.findOne.mockResolvedValue({ ...PENDING });
    const updated = await delegationService.approveRequest(
      { email: ANUSREE.email, role: 'lead', team: 'technical' },
      '6a2c0c5aedd160ce6e3b3e42'
    );
    expect(updated.status).toBe('active');
    expect(updated.approvedBy).toBe(ANUSREE.email);
    const [, update] = delegCol.updateOne.mock.calls[0];
    expect(update.$set.status).toBe('active');
  });

  it('a stranger cannot approve; reject stores the note', async () => {
    delegCol.findOne.mockResolvedValue({ ...PENDING });
    await expect(
      delegationService.approveRequest(
        { email: 'prateek.narvariya@silverspaceinc.com', role: 'lead', team: 'technical' },
        '6a2c0c5aedd160ce6e3b3e42'
      )
    ).rejects.toThrow(/assigned approver/);

    delegCol.findOne.mockResolvedValue({ ...PENDING });
    const rejected = await delegationService.rejectRequest(
      { email: ANUSREE.email, role: 'lead', team: 'technical' },
      '6a2c0c5aedd160ce6e3b3e42',
      'covering internally instead'
    );
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectNote).toBe('covering internally instead');
  });
});

describe('active-grant reads exclude pending/rejected and dormant windows', () => {
  it('listActiveForUser filters on status and startsAt', async () => {
    await delegationService.listActiveForUser(UTSA.email);
    const [query] = delegCol.find.mock.calls[0];
    expect(query.status).toEqual({ $nin: ['pending', 'rejected'] });
    const startsClause = query.$and.find((c) =>
      (c.$or || []).some((o) => 'startsAt' in o)
    );
    expect(startsClause).toBeDefined();
  });
});

describe('eligibleOptions', () => {
  it('an expert\'s delegates are same-team experts only; dept experts are flagged mine/other', async () => {
    const opts = await delegationService.eligibleOptions(
      { email: SUBHASH.email, role: 'expert', team: 'technical' }
    );
    expect(opts.actorRole).toBe('user');
    expect(opts.delegates.map((d) => d.email)).toEqual([UTSA.email]);
    // Utsa shares Subhash's lead → flagged as same-squad (mine is from the
    // ACTOR's perspective: Subhash is not a lead so nothing is 'mine').
    expect(opts.deptExperts.map((d) => d.email)).toEqual([UTSA.email]);
  });

  it('a lead sees their own reports in myPeople', async () => {
    const opts = await delegationService.eligibleOptions(
      { email: ANUSREE.email, role: 'lead', team: 'technical' }
    );
    expect(opts.myPeople.map((d) => d.email).sort()).toEqual([SUBHASH.email, UTSA.email]);
    expect(opts.deptExperts.every((d) => d.mine)).toBe(true);
  });
});
