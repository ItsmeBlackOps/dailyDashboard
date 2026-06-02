import { describe, it, expect } from '@jest/globals';
import { buildEventPayload } from '../src/services/meetingProvisioningService.js';

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
