import { describe, it, expect } from '@jest/globals';
import { TaskModel } from '../src/models/Task.js';

// SP3 — the interview-date tab filters on the indexed `interviewStartAt`
// (a real BSON Date), NOT a $dateFromString parse of the "Date of Interview"
// MM/DD/YYYY string. The string approach could not use an index (collection
// scan → slow + heavy) and dropped/mis-bucketed unparseable rows. The bounds
// are Eastern-aware UTC instants (taskService.resolveDateRange), so the range
// is timezone-identical to the prior match.
const model = new TaskModel();
const lo = '2026-06-03T04:00:00.000Z'; // Eastern midnight 6/3 → UTC
const hi = '2026-06-04T04:00:00.000Z';

describe('buildDateMatch — indexed interviewStartAt (SP3)', () => {
  it('Date of Interview tab → interviewStartAt range, no $dateFromString/$expr', () => {
    const m = model.buildDateMatch('Date of Interview', lo, hi);
    expect(m).toEqual({ interviewStartAt: { $gte: new Date(lo), $lt: new Date(hi) } });
    expect(JSON.stringify(m)).not.toMatch(/dateFromString|expr/i);
  });

  it('default/undefined tab also uses interviewStartAt', () => {
    expect(model.buildDateMatch(undefined, lo, hi)).toEqual({
      interviewStartAt: { $gte: new Date(lo), $lt: new Date(hi) },
    });
  });

  it('receivedDateTime tab is unchanged (ISO string range, already indexed)', () => {
    expect(model.buildDateMatch('receivedDateTime', lo, hi)).toEqual({
      receivedDateTime: { $gte: lo, $lt: hi },
    });
  });

  it('honors partial bounds (only start / only end)', () => {
    expect(model.buildDateMatch('Date of Interview', lo, undefined)).toEqual({
      interviewStartAt: { $gte: new Date(lo) },
    });
    expect(model.buildDateMatch('Date of Interview', undefined, hi)).toEqual({
      interviewStartAt: { $lt: new Date(hi) },
    });
  });

  it('no bounds → {} for either tab', () => {
    expect(model.buildDateMatch('Date of Interview')).toEqual({});
    expect(model.buildDateMatch('receivedDateTime')).toEqual({});
  });
});
