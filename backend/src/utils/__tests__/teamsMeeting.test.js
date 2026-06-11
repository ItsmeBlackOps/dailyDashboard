import { extractMeetingThreadId, escapeRegExp } from '../teamsMeeting.js';

describe('extractMeetingThreadId', () => {
  it('extracts the meeting token from an encoded meetup-join URL', () => {
    const url = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC123def%40thread.v2/0?context=%7b%7d';
    expect(extractMeetingThreadId(url)).toBe('meeting_ABC123def');
  });

  it('extracts from a decoded URL', () => {
    expect(extractMeetingThreadId('https://teams.microsoft.com/l/meetup-join/19:meeting_XYZ@thread.v2/0'))
      .toBe('meeting_XYZ');
  });

  it('yields the SAME token from the encoded and decoded forms of one meeting', () => {
    const a = extractMeetingThreadId('19%3ameeting_Same-Token_1%40thread.v2');
    const b = extractMeetingThreadId('19:meeting_Same-Token_1@thread.v2');
    expect(a).toBe('meeting_Same-Token_1');
    expect(a).toBe(b);
  });

  it('returns null when there is no meeting token', () => {
    expect(extractMeetingThreadId('https://example.com/foo')).toBeNull();
    expect(extractMeetingThreadId('')).toBeNull();
    expect(extractMeetingThreadId(null)).toBeNull();
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b*c+')).toBe('a\\.b\\*c\\+');
  });
});
