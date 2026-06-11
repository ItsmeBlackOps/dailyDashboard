import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

const findOne = jest.fn();
const updateOne = jest.fn(async () => ({ modifiedCount: 1 }));

jest.unstable_mockModule('../../config/index.js', () => ({ config: { auth: { jwtSecret: 'test-secret' } } }));
jest.unstable_mockModule('../../config/database.js', () => ({
  database: { getCollection: () => ({ findOne, updateOne }) },
}));
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { meetingPresenceService } = await import('../meetingPresenceService.js');

const URL_IN = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0';

beforeEach(() => {
  jest.clearAllMocks();
  updateOne.mockResolvedValue({ modifiedCount: 1 });
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
    findOne.mockResolvedValue({ _id: 'task1', meetingStarted: false });
    const r = await meetingPresenceService.recordPresence({ email: 'e@x.com', meetingUrl: URL_IN, state: 'in_call' });
    expect(r).toEqual({ matched: true, taskId: 'task1', flagged: true });
    const setArg = updateOne.mock.calls[0][1].$set;
    expect(setArg.meetingStarted).toBe(true);
    expect(setArg.meetingStartedBy).toBe('e@x.com');
    expect(setArg.meetingStartedSource).toBe('extension');
  });

  it('does NOT flip on lobby state', async () => {
    findOne.mockResolvedValue({ _id: 'task1', meetingStarted: false });
    const r = await meetingPresenceService.recordPresence({ email: 'e@x.com', meetingUrl: URL_IN, state: 'lobby' });
    expect(r.flagged).toBe(false);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('is idempotent when the meeting is already started', async () => {
    findOne.mockResolvedValue({ _id: 'task1', meetingStarted: true });
    const r = await meetingPresenceService.recordPresence({ email: 'e@x.com', meetingUrl: URL_IN, state: 'in_call' });
    expect(r.alreadyStarted).toBe(true);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('returns no_meeting_id when the URL carries no token (and never hits the DB)', async () => {
    const r = await meetingPresenceService.recordPresence({ email: 'e@x.com', meetingUrl: 'https://x.com', state: 'in_call' });
    expect(r).toEqual({ matched: false, reason: 'no_meeting_id' });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('returns no_task when nothing matches', async () => {
    findOne.mockResolvedValue(null);
    const r = await meetingPresenceService.recordPresence({ email: 'e@x.com', meetingUrl: URL_IN, state: 'in_call' });
    expect(r).toEqual({ matched: false, reason: 'no_task' });
  });
});
