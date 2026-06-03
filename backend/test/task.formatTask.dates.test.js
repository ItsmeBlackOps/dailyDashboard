import { describe, it, expect } from '@jest/globals';
import { TaskModel } from '../src/models/Task.js';

// SP3 Phase A — formatTask surfaces the canonical interview Date fields
// (interviewStartAt / interviewEndsAt are proper BSON Dates in UTC) as ISO
// strings, plus Eastern-formatted display values. The legacy "Date of
// Interview" / "Start Time Of Interview" / "End Time Of Interview" string
// fields are kept untouched, and formatTask still requires them to be valid
// (it returns null otherwise) — so both fixtures include valid legacy fields.

const model = new TaskModel();

// A valid legacy interview block so formatTask reaches its return object.
const legacy = {
  _id: 'task-1',
  'Date of Interview': '06/03/2026',
  'Start Time Of Interview': '9:00 AM',
  'End Time Of Interview': '9:30 AM'
};

describe('formatTask — interview start/end (SP3)', () => {
  it('surfaces interviewStartAt/EndsAt as ISO + EST display when present', () => {
    const out = model.formatTask({
      ...legacy,
      interviewStartAt: new Date('2026-06-03T13:00:00.000Z'),
      interviewEndsAt: new Date('2026-06-03T13:30:00.000Z')
    });

    expect(out).toBeTruthy();
    expect(out.interviewStartAt).toBe('2026-06-03T13:00:00.000Z');
    expect(out.interviewEndsAt).toBe('2026-06-03T13:30:00.000Z');
    // 13:00Z = 9:00 AM EDT (America/New_York), 13:30Z = 9:30 AM EDT.
    expect(out.interviewStartEst).toContain('9:00 AM');
    expect(out.interviewEndEst).toContain('9:30 AM');
  });

  it('returns null for all four when interviewStartAt/EndsAt are absent (no throw)', () => {
    const out = model.formatTask({ ...legacy });

    expect(out).toBeTruthy();
    expect(out.interviewStartAt).toBeNull();
    expect(out.interviewEndsAt).toBeNull();
    expect(out.interviewStartEst).toBeNull();
    expect(out.interviewEndEst).toBeNull();
  });
});
