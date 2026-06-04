import { describe, it, expect } from '@jest/globals';
import { userModel } from '../src/models/User.js';

// The premature-meeting-start warning re-shows by reading `meetingStartWarning`
// from getUserByEmail (the in-memory cache). formatCachePayload must carry the
// subdoc, or the GET would always see it absent → never required (the same
// omission that broke the ack re-show before).
describe('formatCachePayload — caches meetingStartWarning', () => {
  it('carries meetingStartWarning when present', () => {
    const w = { shownCount: 1, dismissed: false, meetings: [{ candidate: 'Meka' }] };
    const payload = userModel.formatCachePayload({ email: 'e@x.com', role: 'user', meetingStartWarning: w });
    expect(payload.meetingStartWarning).toEqual(w);
  });

  it('defaults to null when absent', () => {
    const payload = userModel.formatCachePayload({ email: 'e@x.com', role: 'user' });
    expect(payload.meetingStartWarning).toBeNull();
  });
});
