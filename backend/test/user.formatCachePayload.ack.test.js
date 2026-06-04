import { describe, it, expect } from '@jest/globals';
import { userModel } from '../src/models/User.js';

// Bug: the one-time acknowledgment pop-ups (technical + marketing) re-showed
// forever because formatCachePayload (what getUserByEmail returns) omitted the
// ack subdocs — so getMy*Acknowledgment always read agreedVersion=0 →
// required=true, even after the PATCH persisted the ack to Mongo.
describe('formatCachePayload — caches the ack subdocs', () => {
  it('carries technicalAck + marketingMeetingAck when present', () => {
    const payload = userModel.formatCachePayload({
      email: 'e@x.com',
      role: 'user',
      technicalAck: { version: 1, agreedAt: '2026-06-04T00:00:00.000Z' },
      marketingMeetingAck: { version: 2, agreedAt: '2026-06-04T01:00:00.000Z' },
    });
    expect(payload.technicalAck).toEqual({ version: 1, agreedAt: '2026-06-04T00:00:00.000Z' });
    expect(payload.marketingMeetingAck).toEqual({ version: 2, agreedAt: '2026-06-04T01:00:00.000Z' });
  });

  it('defaults both to null when absent (so required stays computable)', () => {
    const payload = userModel.formatCachePayload({ email: 'e@x.com', role: 'user' });
    expect(payload.technicalAck).toBeNull();
    expect(payload.marketingMeetingAck).toBeNull();
  });
});
