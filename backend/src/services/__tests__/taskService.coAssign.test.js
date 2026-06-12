import { jest } from '@jest/globals';

const findOne = jest.fn();
const updateOne = jest.fn(async () => ({ modifiedCount: 1 }));
const findToArray = jest.fn(async () => []);
const findChain = jest.fn(() => ({ limit: jest.fn(() => ({ toArray: findToArray })) }));
const mockCollection = { findOne, updateOne, find: findChain };

jest.unstable_mockModule('../../models/Task.js', () => ({
  taskModel: { collection: mockCollection },
  TASK_EXCLUDE_HEAVY: {},
}));

const getUserByEmail = jest.fn();
jest.unstable_mockModule('../../models/User.js', () => ({
  userModel: { getUserByEmail },
}));

jest.unstable_mockModule('../userService.js', () => ({
  userService: {
    deriveDisplayNameFromEmail: (email) => {
      const local = (email || '').split('@')[0];
      return local
        .split(/[._]/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');
    },
  },
}));

const createNotification = jest.fn(async () => ({}));
jest.unstable_mockModule('../notificationService.js', () => ({
  notificationService: { createNotification },
}));

const resolveTeamLeadEmail = jest.fn(async () => 'anusree.vasudevan@vizvainc.com');
jest.unstable_mockModule('../delegationService.js', () => ({
  delegationService: { listActiveForUser: jest.fn(async () => []) },
  resolveTeamLeadEmail,
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  createTimer: jest.fn(() => ({ end: jest.fn() })),
}));

const { taskService } = await import('../taskService.js');

const TASK_ID = '6a2c0c5aedd160ce6e3b3e42';
const TASK = {
  _id: TASK_ID,
  subject: 'Interview Support - Venkata Kaseeswar Amirisetty - Data Engin',
  assignedTo: 'subhash.sharma@vizvainc.com',
  coAssignees: [],
  pendingCoAssigns: [],
};

const USERS = {
  'subhash.sharma@vizvainc.com': { email: 'subhash.sharma@vizvainc.com', role: 'expert', team: 'technical', teamLead: 'Anusree Vasudevan', active: true },
  'utsa.maiti@vizvainc.com': { email: 'utsa.maiti@vizvainc.com', role: 'expert', team: 'technical', teamLead: 'Anusree Vasudevan', active: true },
  'aditya.sharma@vizvainc.com': { email: 'aditya.sharma@vizvainc.com', role: 'expert', team: 'technical', teamLead: 'Prateek Narvariya', active: true },
  'rahul.recruiter@vizvainc.com': { email: 'rahul.recruiter@vizvainc.com', role: 'recruiter', team: 'marketing', teamLead: 'Brhamdev Sharma', active: true },
};

beforeEach(() => {
  jest.clearAllMocks();
  findOne.mockResolvedValue({ ...TASK, coAssignees: [], pendingCoAssigns: [] });
  getUserByEmail.mockImplementation((email) => USERS[(email || '').toLowerCase()] || null);
});

const ANUSREE = { email: 'anusree.vasudevan@vizvainc.com', role: 'lead' };
const PRATEEK = { email: 'prateek.narvariya@silverspaceinc.com', role: 'lead' };

describe('addCoAssignee', () => {
  it('a lead adds their OWN report instantly ($addToSet)', async () => {
    const r = await taskService.addCoAssignee(ANUSREE, TASK_ID, 'utsa.maiti@vizvainc.com');
    expect(r).toEqual({ success: true, status: 'added' });
    const [, update] = updateOne.mock.calls[0];
    expect(update.$addToSet).toEqual({ coAssignees: 'utsa.maiti@vizvainc.com' });
    expect(createNotification).toHaveBeenCalledWith(
      'utsa.maiti@vizvainc.com',
      expect.objectContaining({ title: 'You were added to a task' })
    );
  });

  it('a lead adding a CROSS-SQUAD expert creates a pending entry for that expert\'s lead', async () => {
    resolveTeamLeadEmail.mockResolvedValue('prateek.narvariya@silverspaceinc.com');
    const r = await taskService.addCoAssignee(ANUSREE, TASK_ID, 'aditya.sharma@vizvainc.com');
    expect(r.status).toBe('pending');
    expect(r.approverEmail).toBe('prateek.narvariya@silverspaceinc.com');
    const [, update] = updateOne.mock.calls[0];
    expect(update.$push.pendingCoAssigns).toMatchObject({
      email: 'aditya.sharma@vizvainc.com',
      requestedBy: ANUSREE.email,
      approverEmail: 'prateek.narvariya@silverspaceinc.com',
    });
  });

  it('an expert may request a co-expert on their OWN task only', async () => {
    resolveTeamLeadEmail.mockResolvedValue('anusree.vasudevan@vizvainc.com');
    const own = await taskService.addCoAssignee(
      { email: 'subhash.sharma@vizvainc.com', role: 'expert' }, TASK_ID, 'utsa.maiti@vizvainc.com'
    );
    expect(own.status).toBe('pending');

    await expect(
      taskService.addCoAssignee(
        { email: 'aditya.sharma@vizvainc.com', role: 'expert' }, TASK_ID, 'utsa.maiti@vizvainc.com'
      )
    ).rejects.toThrow(/own tasks/);
  });

  it('refuses non-expert co-assignees and cross-department pairs', async () => {
    await expect(
      taskService.addCoAssignee(ANUSREE, TASK_ID, 'rahul.recruiter@vizvainc.com')
    ).rejects.toThrow(/expert-tier/);

    USERS['cross.dept@vizvainc.com'] = { email: 'cross.dept@vizvainc.com', role: 'expert', team: 'marketing', teamLead: 'Someone Else', active: true };
    await expect(
      taskService.addCoAssignee(ANUSREE, TASK_ID, 'cross.dept@vizvainc.com')
    ).rejects.toThrow(/same department/);
    delete USERS['cross.dept@vizvainc.com'];
  });
});

describe('approve / reject / remove', () => {
  const PENDING_TASK = {
    ...TASK,
    pendingCoAssigns: [{
      email: 'aditya.sharma@vizvainc.com',
      requestedBy: ANUSREE.email,
      approverEmail: 'prateek.narvariya@silverspaceinc.com',
    }],
  };

  it('only the assigned approver (or admin) approves; approval moves pending → coAssignees', async () => {
    findOne.mockResolvedValue({ ...PENDING_TASK });
    await expect(
      taskService.approveCoAssignee(ANUSREE, TASK_ID, 'aditya.sharma@vizvainc.com')
    ).rejects.toThrow(/assigned approver/);

    findOne.mockResolvedValue({ ...PENDING_TASK });
    const r = await taskService.approveCoAssignee(PRATEEK, TASK_ID, 'aditya.sharma@vizvainc.com');
    expect(r.status).toBe('added');
    const [, update] = updateOne.mock.calls[0];
    expect(update.$addToSet).toEqual({ coAssignees: 'aditya.sharma@vizvainc.com' });
    expect(update.$pull).toEqual({ pendingCoAssigns: { email: 'aditya.sharma@vizvainc.com' } });
  });

  it('reject pulls the pending entry and notifies the requester', async () => {
    findOne.mockResolvedValue({ ...PENDING_TASK });
    const r = await taskService.rejectCoAssignee(PRATEEK, TASK_ID, 'aditya.sharma@vizvainc.com', 'busy week');
    expect(r.status).toBe('rejected');
    expect(createNotification).toHaveBeenCalledWith(
      ANUSREE.email,
      expect.objectContaining({ title: 'Co-expert request declined' })
    );
  });

  it('remove: the expert\'s own lead can, another lead cannot', async () => {
    findOne.mockResolvedValue({ ...TASK, coAssignees: ['utsa.maiti@vizvainc.com'] });
    await expect(
      taskService.removeCoAssignee(PRATEEK, TASK_ID, 'utsa.maiti@vizvainc.com')
    ).rejects.toThrow(/lead or an admin/);

    findOne.mockResolvedValue({ ...TASK, coAssignees: ['utsa.maiti@vizvainc.com'] });
    const r = await taskService.removeCoAssignee(ANUSREE, TASK_ID, 'utsa.maiti@vizvainc.com');
    expect(r.status).toBe('removed');
  });
});

describe('listPendingCoAssignsForApprover', () => {
  it('flattens only the entries waiting on this approver', async () => {
    findToArray.mockResolvedValue([
      {
        _id: 't1',
        subject: 'Interview Support - Venkata Kaseeswar',
        assignedTo: 'subhash.sharma@vizvainc.com',
        pendingCoAssigns: [
          { email: 'aditya.sharma@vizvainc.com', requestedBy: 'anusree.vasudevan@vizvainc.com', requestedAt: 'x', approverEmail: 'prateek.narvariya@silverspaceinc.com' },
          { email: 'other@x.com', requestedBy: 'a@x.com', requestedAt: 'y', approverEmail: 'someone.else@x.com' },
        ],
      },
    ]);
    const items = await taskService.listPendingCoAssignsForApprover('PRATEEK.NARVARIYA@silverspaceinc.com');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      taskId: 't1',
      email: 'aditya.sharma@vizvainc.com',
      ownerEmail: 'subhash.sharma@vizvainc.com',
    });
  });
});

describe('resolveDelegatedCoverage', () => {
  it('reshapes grants into the model filter context', async () => {
    const { delegationService } = await import('../delegationService.js');
    delegationService.listActiveForUser.mockResolvedValue([
      { scope: 'tasks', taskIds: [TASK_ID], ownerEmail: 'subhash.sharma@vizvainc.com' },
      { scope: 'day', dayDate: '2026-06-13', ownerEmail: 'subhash.sharma@vizvainc.com' },
      { scope: 'subtree', subtreeRootEmail: 'subhash.sharma@vizvainc.com', ownerEmail: 'subhash.sharma@vizvainc.com' },
      { scope: 'subtree', subtreeRootEmail: 'someone.else@x.com', ownerEmail: 'a.lead@x.com' },
    ]);
    const ctx = await taskService.resolveDelegatedCoverage('utsa.maiti@vizvainc.com');
    expect(ctx.taskIdSet.has(TASK_ID)).toBe(true);
    expect(ctx.dayGrants).toEqual([{ owner: 'subhash.sharma@vizvainc.com', dayDate: '2026-06-13' }]);
    expect(ctx.windowOwners.has('subhash.sharma@vizvainc.com')).toBe(true);
    expect(ctx.windowOwners.has('a.lead@x.com')).toBe(false);
  });

  it('returns null when the user has no grants', async () => {
    const { delegationService } = await import('../delegationService.js');
    delegationService.listActiveForUser.mockResolvedValue([]);
    expect(await taskService.resolveDelegatedCoverage('x@y.com')).toBeNull();
  });
});
