import { jest } from '@jest/globals';
import moment from 'moment-timezone';

// ---- shared mock state, reset per test ----
const ff = {
  enabled: true,
  isRateLimited: jest.fn(() => false),
  getRateLimitedUntil: jest.fn(() => 0),
  inviteBot: jest.fn(async () => ({})),
  isBotInMeeting: jest.fn(async () => true),
};

const auditInserts = [];
const updateOnes = [];
let findResults = [];
let leaseResult = { owner: 'me', expiresAt: new Date(Date.now() + 90000) }; // doc => lease acquired
let leaseError = null;

const fakeTaskCol = {
  find: jest.fn(() => ({
    sort: () => ({ limit: () => ({ toArray: async () => findResults }) }),
  })),
  countDocuments: jest.fn(async () => 0),
  updateOne: jest.fn(async (...a) => { updateOnes.push(a); return { matchedCount: 1 }; }),
};
const fakeAuditCol = { insertOne: jest.fn(async (doc) => { auditInserts.push(doc); }) };
const fakeLockCol = {
  findOneAndUpdate: jest.fn(async () => {
    if (leaseError) throw leaseError;
    return leaseResult;
  }),
};

jest.unstable_mockModule('../../services/firefliesService.js', () => ({
  firefliesService: ff,
  FirefliesRateLimitError: class FirefliesRateLimitError extends Error {
    constructor(retryAfterEpochMs) { super('rate limited'); this.retryAfterEpochMs = retryAfterEpochMs; }
  },
}));
jest.unstable_mockModule('../../config/database.js', () => ({
  database: {
    getDb: () => ({
      collection: (name) => (name === 'schedulerLocks' ? fakeLockCol : fakeTaskCol),
    }),
    getCollection: (name) => (name === 'auditLog' ? fakeAuditCol : fakeTaskCol),
  },
}));
jest.unstable_mockModule('../../models/Task.js', () => ({ TASK_EXCLUDE_HEAVY: {} }));
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { _tick, _testing } = await import('../firefliesBotScheduler.js');
const { logger } = await import('../../utils/logger.js');

// helper: a botable task whose interview started `minutesAgo` minutes ago (EST string format)
const taskStartedMinutesAgo = (minutesAgo, overrides = {}) => ({
  _id: 't1',
  subject: 'Interview Support - Example',
  'Candidate Name': 'Vaishnavi Example',
  meetingLink: 'https://teams.microsoft.com/l/meetup-join/xyz',
  botStatus: 'pending',
  botInviteAttempts: 0,
  interviewDateTime: moment().tz('America/New_York').subtract(minutesAgo, 'minutes').format('YYYY-MM-DDTHH:mm'),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  auditInserts.length = 0;
  updateOnes.length = 0;
  findResults = [];
  leaseResult = { owner: 'me', expiresAt: new Date(Date.now() + 90000) };
  leaseError = null;
  ff.enabled = true;
  ff.isRateLimited.mockReturnValue(false);
  _testing.setLastTickFinishedAt(Date.now());
  _testing.setLastSkipAuditAt(0);
  process.env.FIREFLIES_TICK_PACING_MS = '0';
});

describe('firefliesBotScheduler tick', () => {
  // ---- Task 1: visible rate-limit skip ----

  it('audits + warns when the tick is skipped by rate-limit cooldown', async () => {
    ff.isRateLimited.mockReturnValue(true);
    ff.getRateLimitedUntil.mockReturnValue(Date.now() + 3600_000);

    await _tick();

    expect(ff.isRateLimited).toHaveBeenCalledWith('invite');
    expect(fakeTaskCol.find).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('tick skipped'), expect.any(Object));
    const row = auditInserts.find((d) => d.phase === 'FIREFLIES_TICK_SKIPPED_RATELIMIT');
    expect(row).toBeTruthy();
    expect(row.level).toBe('warning');
    expect(row.subject).toBe('scheduler');
    expect(row.extra.cooldownUntil).toBeTruthy();
  });

  it('throttles the skip audit row (one per interval, warn still every tick)', async () => {
    ff.isRateLimited.mockReturnValue(true);
    ff.getRateLimitedUntil.mockReturnValue(Date.now() + 3600_000);

    await _tick();
    await _tick();

    const rows = auditInserts.filter((d) => d.phase === 'FIREFLIES_TICK_SKIPPED_RATELIMIT');
    expect(rows.length).toBe(1);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  // ---- Task 2: catch-up sweep ----

  it('catch-up: invites a pending task that started 9 min ago after a 10-min tick gap', async () => {
    _testing.setLastTickFinishedAt(Date.now() - 10 * 60_000);
    findResults = [taskStartedMinutesAgo(9)];

    await _tick();

    expect(ff.inviteBot).toHaveBeenCalledTimes(1);
    const set = updateOnes.find(([, u]) => u.$set?.botStatus === 'main_invited');
    expect(set).toBeTruthy();
    expect(auditInserts.some((d) => d.phase === 'FIREFLIES_CATCHUP_SWEEP')).toBe(true);
  });

  it('no catch-up grace on a normal cadence: a task 9 min past start is NOT invited', async () => {
    findResults = [taskStartedMinutesAgo(9)]; // lastTickFinishedAt = now (beforeEach)

    await _tick();

    expect(ff.inviteBot).not.toHaveBeenCalled();
  });

  it('catch-up grace is capped: a task 30 min past start is not picked up even after a long gap', async () => {
    _testing.setLastTickFinishedAt(Date.now() - 60 * 60_000);
    findResults = [taskStartedMinutesAgo(30)];

    await _tick();

    expect(ff.inviteBot).not.toHaveBeenCalled();
  });

  // ---- Task 4: single-owner lease ----

  it('skips the tick when another instance holds the lease', async () => {
    leaseResult = null; // driver v6: no doc matched => lease held elsewhere
    findResults = [taskStartedMinutesAgo(2)];

    await _tick();

    expect(fakeTaskCol.find).not.toHaveBeenCalled();
    expect(ff.inviteBot).not.toHaveBeenCalled();
  });

  it('treats a duplicate-key race on lease upsert as "lease held elsewhere"', async () => {
    leaseError = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    findResults = [taskStartedMinutesAgo(2)];

    await _tick();

    expect(ff.inviteBot).not.toHaveBeenCalled();
  });

  it('runs the tick when the lease is acquired', async () => {
    findResults = [taskStartedMinutesAgo(2)]; // leaseResult = doc (beforeEach)

    await _tick();

    expect(fakeLockCol.findOneAndUpdate).toHaveBeenCalled();
    expect(ff.inviteBot).toHaveBeenCalledTimes(1); // Stage C: 2 min past start
  });
});
