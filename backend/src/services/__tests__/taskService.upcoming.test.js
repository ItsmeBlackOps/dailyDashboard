import { jest } from '@jest/globals';

const toArray = jest.fn();
const limit = jest.fn(() => ({ toArray }));
const sort = jest.fn(() => ({ limit }));
const find = jest.fn(() => ({ sort }));

const mockCollection = { find };

jest.unstable_mockModule('../../models/Task.js', () => ({
  taskModel: { collection: mockCollection },
  TASK_EXCLUDE_HEAVY: {},
}));
jest.unstable_mockModule('../../models/User.js', () => ({
  userModel: {},
}));
jest.unstable_mockModule('../userService.js', () => ({
  userService: {},
}));
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  createTimer: jest.fn(() => ({ end: jest.fn() })),
}));

const { taskService } = await import('../taskService.js');

describe('getUpcomingUnstarted', () => {
  beforeEach(() => {
    find.mockClear();
    toArray.mockReset();
  });

  it('queries the ±window on interviewStartAt for unstarted, non-mock tasks', async () => {
    toArray.mockResolvedValue([]);
    const before = Date.now();
    await taskService.getUpcomingUnstarted(20, 15);
    const after = Date.now();

    const [query] = find.mock.calls[0];
    expect(query.meetingStarted).toEqual({ $ne: true });
    expect(query.taskType).toEqual({ $ne: 'mock' });
    // window: [now - 15m, now + 20m]
    expect(query.interviewStartAt.$gte.getTime()).toBeGreaterThanOrEqual(before - 15 * 60 * 1000);
    expect(query.interviewStartAt.$gte.getTime()).toBeLessThanOrEqual(after - 15 * 60 * 1000);
    expect(query.interviewStartAt.$lte.getTime()).toBeGreaterThanOrEqual(before + 20 * 60 * 1000);
    expect(query.interviewStartAt.$lte.getTime()).toBeLessThanOrEqual(after + 20 * 60 * 1000);
  });

  it('maps docs and drops inactive statuses (case-insensitive)', async () => {
    const startAt = new Date('2026-06-12T15:30:00Z');
    toArray.mockResolvedValue([
      {
        _id: { toString: () => 'a1' },
        'Candidate Name': 'Janavi Soni',
        'Job Title': 'Tax Preparer',
        'End Client': 'Acme',
        'Interview Round': '2nd',
        status: 'pending',
        interviewStartAt: startAt,
        assignedTo: 'expert@x.com',
        meetingLink: 'https://teams.microsoft.com/x',
      },
      {
        _id: { toString: () => 'a2' },
        'Candidate Name': 'Cancelled Person',
        status: 'Cancelled',
        interviewStartAt: startAt,
      },
    ]);

    const result = await taskService.getUpcomingUnstarted();

    expect(result.success).toBe(true);
    expect(result.tasks).toHaveLength(1);
    const t = result.tasks[0];
    expect(t).toMatchObject({
      taskId: 'a1',
      candidateName: 'Janavi Soni',
      role: 'Tax Preparer',
      client: 'Acme',
      round: '2nd',
      assignedTo: 'expert@x.com',
      hasMeetingLink: true,
      interviewStartAt: startAt.toISOString(),
    });
    // 15:30Z = 11:30 AM EDT
    expect(t.interviewStartEst).toBe('11:30 AM');
  });

  it('returns an empty list when the collection is unavailable', async () => {
    const saved = taskService.taskModel.collection;
    taskService.taskModel.collection = null;
    try {
      const result = await taskService.getUpcomingUnstarted();
      expect(result).toMatchObject({ success: true, tasks: [] });
      expect(find).not.toHaveBeenCalled();
    } finally {
      taskService.taskModel.collection = saved;
    }
  });
});
