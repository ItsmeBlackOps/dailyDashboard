import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

const toArray = jest.fn();
const limit = jest.fn(() => ({ toArray }));
const find = jest.fn(() => ({ limit }));
const updateMany = jest.fn(async () => ({ modifiedCount: 1 }));

jest.unstable_mockModule('../../config/index.js', () => ({ config: { auth: { jwtSecret: 'test-secret' } } }));
jest.unstable_mockModule('../../config/database.js', () => ({
  database: { getCollection: () => ({ find, updateMany }) },
}));
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { meetingPresenceService } = await import('../meetingPresenceService.js');

const URL_IN = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0';

beforeEach(() => {
  jest.clearAllMocks();
  updateMany.mockResolvedValue({ modifiedCount: 1 });
});

describe('issueDetectorToken', () => {
  it('mints a scoped, verifiable JWT', () => {
    const t = meetingPresenceService.issueDetectorToken('e@x.com');
    const decoded = jwt.verify(t, 'test-secret');
    expect(decoded.email).toBe('e@x.com');
    expect(decoded.scope).toBe('meeting-presence');
  });
});

describe('recordPresence', () => {
  it('flips meetingStarted on in_call for a matching task', async () => {
    toArray.mockResolvedValue([{ _id: 'task1', meetingStarted: false }]);
    const r = await meetingPresenceService.recordPresence({ email: 'e@x.com', meetingUrl: URL_IN, state: 'in_call' });
    expect(r).toEqual({ matched: true, taskId: 'task1', taskIds: ['task1'], flagged: true, flaggedCount: 1 });
    const [filter, update] = updateMany.mock.calls[0];
    // The update targets every unstarted row of this meeting, not one _id.
    expect(filter.meetingStarted).toEqual({ $ne: true });
    expect(filter.$or).toBeDefined();
    expect(filter._id).toBeUndefined();
    expect(update.$set.meetingStarted).toBe(true);
    expect(update.$set.meetingStartedBy).toBe('e@x.com');
    expect(update.$set.meetingStartedSource).toBe('extension');
  });

  it('flips ALL unstarted rows sharing the meeting — even when one is already started', async () => {
    // Regression: findOne used to pick the started row arbitrarily and
    // short-circuit, stranding the other task of the same meeting.
    toArray.mockResolvedValue([
      { _id: 'old-task', meetingStarted: true },
      { _id: 'new-task', meetingStarted: false },
    ]);
    updateMany.mockResolvedValue({ modifiedCount: 1 });
    const r = await meetingPresenceService.recordPresence({ email: 'e@x.com', meetingUrl: URL_IN, state: 'in_call' });
    expect(r.matched).toBe(true);
    expect(r.flagged).toBe(true);
    expect(r.flaggedCount).toBe(1);
    expect(r.taskIds).toEqual(['old-task', 'new-task']);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('does NOT flip on lobby state', async () => {
    toArray.mockResolvedValue([{ _id: 'task1', meetingStarted: false }]);
    const r = await meetingPresenceService.recordPresence({ email: 'e@x.com', meetingUrl: URL_IN, state: 'lobby' });
    expect(r.flagged).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('is idempotent when every matching row is already started', async () => {
    toArray.mockResolvedValue([{ _id: 'task1', meetingStarted: true }]);
    updateMany.mockResolvedValue({ modifiedCount: 0 });
    const r = await meetingPresenceService.recordPresence({ email: 'e@x.com', meetingUrl: URL_IN, state: 'in_call' });
    expect(r.alreadyStarted).toBe(true);
    expect(r.flagged).toBe(false);
  });

  it('returns no_meeting_id when the URL carries no token (and never hits the DB)', async () => {
    const r = await meetingPresenceService.recordPresence({ email: 'e@x.com', meetingUrl: 'https://x.com', state: 'in_call' });
    expect(r).toEqual({ matched: false, reason: 'no_meeting_id' });
    expect(find).not.toHaveBeenCalled();
  });

  it('returns no_task when nothing matches', async () => {
    toArray.mockResolvedValue([]);
    const r = await meetingPresenceService.recordPresence({ email: 'e@x.com', meetingUrl: URL_IN, state: 'in_call' });
    expect(r).toEqual({ matched: false, reason: 'no_task' });
  });
});
