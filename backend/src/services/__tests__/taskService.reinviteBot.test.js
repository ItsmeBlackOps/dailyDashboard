import { jest } from '@jest/globals';

const findOne = jest.fn();
const updateOne = jest.fn(async () => ({ modifiedCount: 1 }));

jest.unstable_mockModule('../../models/Task.js', () => ({
  taskModel: { collection: { findOne, updateOne } },
  TASK_EXCLUDE_HEAVY: {},
}));
jest.unstable_mockModule('../../models/User.js', () => ({
  userModel: { getUserByEmail: jest.fn() },
}));
jest.unstable_mockModule('../userService.js', () => ({
  userService: { deriveDisplayNameFromEmail: (e) => e },
}));
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  createTimer: jest.fn(() => ({ end: jest.fn() })),
}));

const inviteBot = jest.fn(async () => ({ success: true, message: 'ok' }));
jest.unstable_mockModule('../firefliesService.js', () => ({
  firefliesService: { inviteBot },
}));
jest.unstable_mockModule('../delegationService.js', () => ({
  delegationService: { listActiveForUser: jest.fn(async () => []) },
  resolveTeamLeadEmail: jest.fn(async () => null),
}));
jest.unstable_mockModule('../notificationService.js', () => ({
  notificationService: { createNotification: jest.fn(async () => ({})) },
}));

const { taskService } = await import('../taskService.js');

const TASK_ID = '6a2c49bc271798b5faf6cf72';
const TASK = {
  _id: TASK_ID,
  subject: 'Interview Support - Extension Test One',
  assignedTo: 'rahul.agarwal@vizvainc.com',
  coAssignees: ['utsa.maiti@vizvainc.com'],
  meetingLink: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC',
  interviewEndsAt: new Date(Date.now() + 30 * 60 * 1000),
};

beforeEach(() => {
  jest.clearAllMocks();
  inviteBot.mockResolvedValue({ success: true, message: 'ok' });
  findOne.mockResolvedValue({ ...TASK });
});

describe('reinviteBot', () => {
  it('the assigned expert can push Fred back in — invite + status update', async () => {
    const r = await taskService.reinviteBot({ email: 'rahul.agarwal@vizvainc.com', role: 'user' }, TASK_ID);
    expect(r.success).toBe(true);
    expect(inviteBot).toHaveBeenCalledWith(expect.objectContaining({
      meetingLink: TASK.meetingLink,
      title: TASK.subject,
    }));
    // duration ≈ time to scheduled end + 10 slack, within bounds
    const { duration } = inviteBot.mock.calls[0][0];
    expect(duration).toBeGreaterThanOrEqual(15);
    expect(duration).toBeLessThanOrEqual(120);
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.botStatus).toBe('main_invited');
    expect(update.$inc).toEqual({ botInviteAttempts: 1 });
  });

  it('co-experts and leads may; an unrelated expert may not', async () => {
    await taskService.reinviteBot({ email: 'utsa.maiti@vizvainc.com', role: 'expert' }, TASK_ID);
    findOne.mockResolvedValue({ ...TASK });
    await taskService.reinviteBot({ email: 'anusree.vasudevan@vizvainc.com', role: 'lead' }, TASK_ID);
    expect(inviteBot).toHaveBeenCalledTimes(2);

    findOne.mockResolvedValue({ ...TASK });
    await expect(
      taskService.reinviteBot({ email: 'someone.else@vizvainc.com', role: 'user' }, TASK_ID)
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('400 when the task has no meeting link; main_failed when Fireflies rejects', async () => {
    findOne.mockResolvedValue({ ...TASK, meetingLink: null, joinUrl: null, joinWebUrl: null });
    await expect(
      taskService.reinviteBot({ email: 'rahul.agarwal@vizvainc.com', role: 'user' }, TASK_ID)
    ).rejects.toMatchObject({ statusCode: 400 });

    findOne.mockResolvedValue({ ...TASK });
    inviteBot.mockResolvedValue({ success: false, message: 'meeting not live' });
    const r = await taskService.reinviteBot({ email: 'rahul.agarwal@vizvainc.com', role: 'user' }, TASK_ID);
    expect(r.success).toBe(false);
    const [, update] = updateOne.mock.calls.at(-1);
    expect(update.$set.botStatus).toBe('main_failed');
  });
});
