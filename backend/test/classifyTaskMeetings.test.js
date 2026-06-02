import { describe, it, expect } from '@jest/globals';
import { classifyTaskMeetings } from '../scripts/lib/classifyTaskMeetings.js';

const TASK = { subject: 'Interview - Sravani', organizerEmail: 'Int@Co.com', persistedLink: 'https://teams/keep' };
const ev = (over = {}) => ({
  id: 'e',
  isOnlineMeeting: true,
  subject: 'Interview - Sravani',
  organizer: { emailAddress: { address: 'int@co.com' } },
  onlineMeeting: { joinUrl: 'https://teams/x' },
  ...over,
});

describe('classifyTaskMeetings', () => {
  it('none when there are no matching events', () => {
    expect(classifyTaskMeetings(TASK, []).status).toBe('none');
  });

  it('none when only one event matches', () => {
    const r = classifyTaskMeetings(TASK, [ev({ id: 'a' })]);
    expect(r.status).toBe('none');
    expect(r.keep.id).toBe('a');
  });

  it('flags duplicates and keeps the event matching the persisted link (case-insensitive organizer)', () => {
    const keep = ev({ id: 'keep', onlineMeeting: { joinUrl: 'https://teams/keep' } });
    const dup = ev({ id: 'dup', onlineMeeting: { joinUrl: 'https://teams/dup' } });
    const r = classifyTaskMeetings(TASK, [dup, keep]);
    expect(r.status).toBe('duplicates');
    expect(r.keep.id).toBe('keep');
    expect(r.duplicates.map((e) => e.id)).toEqual(['dup']);
  });

  it('ambiguous (cancels nothing) when no event matches the persisted link', () => {
    const r = classifyTaskMeetings(TASK, [
      ev({ id: 'a', onlineMeeting: { joinUrl: 'https://teams/x' } }),
      ev({ id: 'b', onlineMeeting: { joinUrl: 'https://teams/y' } }),
    ]);
    expect(r.status).toBe('ambiguous');
    expect(r.duplicates).toEqual([]);
  });

  it('excludes non-online, wrong-organizer, and wrong-subject events from matching', () => {
    const keep = ev({ id: 'keep', onlineMeeting: { joinUrl: 'https://teams/keep' } });
    const dup = ev({ id: 'dup', onlineMeeting: { joinUrl: 'https://teams/dup' } });
    const notOnline = ev({ id: 'no', isOnlineMeeting: false });
    const otherOrg = ev({ id: 'oo', organizer: { emailAddress: { address: 'someone@else.com' } } });
    const otherSubj = ev({ id: 'os', subject: 'Different' });
    const r = classifyTaskMeetings(TASK, [keep, dup, notOnline, otherOrg, otherSubj]);
    expect(r.status).toBe('duplicates');
    expect(r.keep.id).toBe('keep');
    expect(r.duplicates.map((e) => e.id)).toEqual(['dup']);
  });

  it('never includes the kept event in duplicates', () => {
    const keep = ev({ id: 'keep', onlineMeeting: { joinUrl: 'https://teams/keep' } });
    const dup = ev({ id: 'dup', onlineMeeting: { joinUrl: 'https://teams/dup' } });
    const r = classifyTaskMeetings(TASK, [keep, dup]);
    expect(r.duplicates).not.toContain(keep);
  });
});
