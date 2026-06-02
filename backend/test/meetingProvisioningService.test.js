import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { buildEventPayload, ensureMeetingForTask } from '../src/services/meetingProvisioningService.js';
import { database } from '../src/config/database.js';
import { graphMeetingService } from '../src/services/graphMeetingService.js';

const TASK = {
  subject: 'Interview Support - Sravani Komma - Business Analyst',
  'Candidate Name': 'Sravani Komma',
  'End Client': 'Vizva Inc.',
  'Interview Round': 'Technical',
  'Date of Interview': '06/02/2026',
  'Start Time Of Interview': '12:00 PM',
  'End Time Of Interview': '1:00 PM',
};

describe('buildEventPayload', () => {
  it('builds an online-meeting event with the fixed + Fireflies attendees and ET times', () => {
    const p = buildEventPayload(TASK);
    expect(p.subject).toBe(TASK.subject);
    expect(p.isOnlineMeeting).toBe(true);
    expect(p.onlineMeetingProvider).toBe('teamsForBusiness');
    expect(p.start).toEqual({ dateTime: '2026-06-02T12:00:00', timeZone: 'Eastern Standard Time' });
    expect(p.end).toEqual({ dateTime: '2026-06-02T13:00:00', timeZone: 'Eastern Standard Time' });
    const addresses = p.attendees.map((a) => a.emailAddress.address);
    expect(addresses).toEqual(expect.arrayContaining(['harsh.patel@silverspaceinc.com', 'fred@fireflies.ai']));
    expect(p.body.content).toContain('Sravani Komma');
    expect(p.body.content).toContain('Vizva Inc.');
  });

  it('falls back to a generated subject and returns null on invalid times', () => {
    const noSubject = buildEventPayload({ ...TASK, subject: undefined });
    expect(noSubject.subject).toBe('Interview for Sravani Komma');
    expect(buildEventPayload({ ...TASK, 'Start Time Of Interview': 'garbage' })).toBeNull();
  });
});

const VALID_ID = '507f1f77bcf86cd799439011';
const origGetCollection = database.getCollection;

function mockCollection({ taskDoc, claimResult }) {
  const findOne = jest.fn().mockResolvedValue(taskDoc);
  const findOneAndUpdate = jest.fn().mockResolvedValue(claimResult);
  const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
  const col = { findOne, findOneAndUpdate, updateOne };
  database.getCollection = jest.fn(() => col);
  return col;
}

afterEach(() => { database.getCollection = origGetCollection; jest.restoreAllMocks(); });

const TASK_FULL = {
  _id: VALID_ID, subject: 'I', 'Candidate Name': 'C', 'End Client': 'X', 'Interview Round': 'R',
  'Date of Interview': '06/02/2026', 'Start Time Of Interview': '12:00 PM', 'End Time Of Interview': '1:00 PM',
};

describe('ensureMeetingForTask', () => {
  it('short-circuits without any Graph call when a link already exists', async () => {
    const col = mockCollection({ taskDoc: { ...TASK_FULL, meetingLink: 'https://teams/old' }, claimResult: null });
    const createSpy = jest.spyOn(graphMeetingService, 'createEventMeeting');

    const out = await ensureMeetingForTask({ taskId: VALID_ID, userAssertion: 't', actorEmail: 'a@b.com' });

    expect(out).toMatchObject({ status: 'exists', meetingLink: 'https://teams/old' });
    expect(col.findOneAndUpdate).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('claims, creates, bypasses, persists and releases the lock on the happy path', async () => {
    const col = mockCollection({ taskDoc: TASK_FULL, claimResult: { ...TASK_FULL, meetingCreationLockAt: new Date() } });
    jest.spyOn(graphMeetingService, 'createEventMeeting').mockResolvedValue({ onlineMeeting: { joinUrl: 'https://teams/new' } });
    jest.spyOn(graphMeetingService, 'setMeetingLobbyBypass').mockResolvedValue({});

    const out = await ensureMeetingForTask({ taskId: VALID_ID, userAssertion: 't', actorEmail: 'a@b.com' });

    expect(out).toMatchObject({ status: 'created', meetingLink: 'https://teams/new' });
    const persist = col.updateOne.mock.calls.at(-1)[1];
    expect(persist.$set).toMatchObject({ meetingLink: 'https://teams/new', joinUrl: 'https://teams/new', joinWebUrl: 'https://teams/new', botStatus: 'pending' });
    expect(persist.$unset).toMatchObject({ meetingCreationLockAt: '', meetingCreationLockBy: '' });
  });

  it('returns pending when the claim is lost and no link is present', async () => {
    mockCollection({ taskDoc: TASK_FULL, claimResult: null });
    const createSpy = jest.spyOn(graphMeetingService, 'createEventMeeting');
    const out = await ensureMeetingForTask({ taskId: VALID_ID, userAssertion: 't', actorEmail: 'a@b.com' });
    expect(out).toMatchObject({ status: 'pending' });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('still succeeds (created) when lobby bypass fails', async () => {
    const col = mockCollection({ taskDoc: TASK_FULL, claimResult: { ...TASK_FULL } });
    jest.spyOn(graphMeetingService, 'createEventMeeting').mockResolvedValue({ onlineMeeting: { joinUrl: 'https://teams/new' } });
    jest.spyOn(graphMeetingService, 'setMeetingLobbyBypass').mockRejectedValue(new Error('bypass down'));
    const out = await ensureMeetingForTask({ taskId: VALID_ID, userAssertion: 't', actorEmail: 'a@b.com' });
    expect(out).toMatchObject({ status: 'created', meetingLink: 'https://teams/new' });
    expect(col.updateOne).toHaveBeenCalled();
  });

  it('releases the lock and rethrows when Graph create fails', async () => {
    const col = mockCollection({ taskDoc: TASK_FULL, claimResult: { ...TASK_FULL } });
    jest.spyOn(graphMeetingService, 'createEventMeeting').mockRejectedValue(new Error('graph 500'));
    await expect(ensureMeetingForTask({ taskId: VALID_ID, userAssertion: 't', actorEmail: 'a@b.com' })).rejects.toThrow('graph 500');
    const release = col.updateOne.mock.calls.at(-1)[1];
    expect(release.$unset).toMatchObject({ meetingCreationLockAt: '', meetingCreationLockBy: '' });
  });
});
