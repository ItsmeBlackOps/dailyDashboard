import { jest } from '@jest/globals';

const toArray = jest.fn();
const limit = jest.fn(() => ({ toArray }));
const find = jest.fn(() => ({ limit }));
const updateOne = jest.fn(async () => ({ modifiedCount: 1 }));

jest.unstable_mockModule('../../config/database.js', () => ({
  database: { getCollection: () => ({ find, updateOne }) },
}));

const createNotification = jest.fn(async () => ({}));
jest.unstable_mockModule('../../services/notificationService.js', () => ({
  notificationService: { createNotification },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { sweepBotMissingOnce } = await import('../botMissingAlertScheduler.js');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sweepBotMissingOnce', () => {
  it('targets live, started interviews past the SCHEDULED start with no bot, not yet alerted', async () => {
    toArray.mockResolvedValue([]);
    const before = Date.now();
    await sweepBotMissingOnce();

    const [query] = find.mock.calls[0];
    expect(query.meetingStarted).toBe(true);
    expect(query.botMissingAlertedAt).toEqual({ $exists: false });
    expect(query.botStatus).toEqual({ $nin: ['main_joined', 'completed'] });
    expect(query.taskType).toEqual({ $ne: 'mock' });
    // grace: scheduled start must be at least 5 minutes ago
    expect(query.interviewStartAt.$lte.getTime()).toBeLessThanOrEqual(before - 5 * 60 * 1000 + 1500);
    // still inside the scheduled slot
    expect(query.interviewEndsAt.$gt.getTime()).toBeGreaterThanOrEqual(before - 1500);
  });

  it('notifies the expert AND co-experts with a popup, marking the task first', async () => {
    toArray.mockResolvedValue([{
      _id: 't1',
      subject: 'Interview Support - Venkata - 2:00 PM',
      assignedTo: 'subhash.sharma@vizvainc.com',
      coAssignees: ['utsa.maiti@vizvainc.com'],
      'Start Time Of Interview': '02:00 PM',
    }]);

    const alerted = await sweepBotMissingOnce();

    expect(alerted).toBe(1);
    // dedupe mark written conditionally
    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toMatchObject({ _id: 't1', botMissingAlertedAt: { $exists: false } });
    expect(update.$set.botMissingAlertedAt).toBeInstanceOf(Date);
    // both people pinged, popup on
    const recipients = createNotification.mock.calls.map((c) => c[0]).sort();
    expect(recipients).toEqual(['subhash.sharma@vizvainc.com', 'utsa.maiti@vizvainc.com']);
    for (const [, payload] of createNotification.mock.calls) {
      expect(payload.popup).toBe(true);
      expect(payload.title).toMatch(/recorder missing/i);
      expect(payload.description).toMatch(/Re-invite recorder/);
    }
  });

  it('skips tasks with no recipients and returns 0 on empty sweeps', async () => {
    toArray.mockResolvedValue([{ _id: 't2', subject: 'x', assignedTo: '', coAssignees: [] }]);
    expect(await sweepBotMissingOnce()).toBe(0);
    expect(createNotification).not.toHaveBeenCalled();
  });
});
