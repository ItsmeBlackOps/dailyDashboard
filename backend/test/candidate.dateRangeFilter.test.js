import { describe, it, expect } from '@jest/globals';
import { buildDateRangeFilter } from '../src/models/Candidate.js';

// SP3 Phase C — server-side date-range filter for the Branch Candidates list.
//
// buildDateRangeFilter is the whitelist gate at the model layer. It takes a
// caller-supplied dateField plus ISO from/to bounds and returns a Mongo
// fragment ({ [dateField]: { $gte, $lt } }) ONLY when:
//
//   * dateField is one of the exact whitelist
//     ['marketingStartDate', 'poDate', 'eadEndDate'], and
//   * at least one of from/to parses to a valid Date.
//
// Anything else — unknown/garbage field, no bounds, both bounds unparseable —
// returns {} (no filter), so the list falls back to today's behaviour
// (return all). The whitelist is the security boundary: a client-supplied
// field name must NEVER be interpolated into the query unchecked.
//
// Bounds are inclusive-lower / exclusive-upper ($gte / $lt) because the
// client computes UTC instants for Eastern day boundaries and the upper
// bound is the start of the day *after* the range.

const FROM = '2026-06-01T04:00:00Z';
const TO = '2026-07-01T04:00:00Z';

describe('buildDateRangeFilter — whitelist + bounds', () => {
  it('builds a two-sided $gte/$lt range for a whitelisted field', () => {
    const filter = buildDateRangeFilter('marketingStartDate', FROM, TO);
    expect(filter).toEqual({
      marketingStartDate: {
        $gte: new Date(FROM),
        $lt: new Date(TO)
      }
    });
    // Bounds must be real Date instances, not raw ISO strings.
    expect(filter.marketingStartDate.$gte).toBeInstanceOf(Date);
    expect(filter.marketingStartDate.$lt).toBeInstanceOf(Date);
  });

  it('accepts each whitelisted field', () => {
    expect(buildDateRangeFilter('poDate', FROM, TO)).toEqual({
      poDate: { $gte: new Date(FROM), $lt: new Date(TO) }
    });
    expect(buildDateRangeFilter('eadEndDate', FROM, TO)).toEqual({
      eadEndDate: { $gte: new Date(FROM), $lt: new Date(TO) }
    });
  });

  it('returns {} for a field not on the whitelist', () => {
    expect(buildDateRangeFilter('createdAt', FROM, TO)).toEqual({});
    expect(buildDateRangeFilter('Recruiter', FROM, TO)).toEqual({});
    // a Mongo-operator-ish injection attempt is also rejected
    expect(buildDateRangeFilter('$where', FROM, TO)).toEqual({});
  });

  it('returns {} when dateField is missing / non-string', () => {
    expect(buildDateRangeFilter(undefined, FROM, TO)).toEqual({});
    expect(buildDateRangeFilter(null, FROM, TO)).toEqual({});
    expect(buildDateRangeFilter(42, FROM, TO)).toEqual({});
    expect(buildDateRangeFilter({ marketingStartDate: 1 }, FROM, TO)).toEqual({});
  });

  it('returns {} when both bounds are missing', () => {
    expect(buildDateRangeFilter('marketingStartDate')).toEqual({});
    expect(buildDateRangeFilter('marketingStartDate', undefined, undefined)).toEqual({});
    expect(buildDateRangeFilter('marketingStartDate', null, null)).toEqual({});
    expect(buildDateRangeFilter('marketingStartDate', '', '')).toEqual({});
  });

  it('applies only the lower bound when only `from` is present', () => {
    expect(buildDateRangeFilter('poDate', FROM, undefined)).toEqual({
      poDate: { $gte: new Date(FROM) }
    });
  });

  it('applies only the upper bound when only `to` is present', () => {
    expect(buildDateRangeFilter('poDate', undefined, TO)).toEqual({
      poDate: { $lt: new Date(TO) }
    });
  });

  it('skips an unparseable bound but keeps the valid one', () => {
    expect(buildDateRangeFilter('eadEndDate', 'not-a-date', TO)).toEqual({
      eadEndDate: { $lt: new Date(TO) }
    });
    expect(buildDateRangeFilter('eadEndDate', FROM, 'garbage')).toEqual({
      eadEndDate: { $gte: new Date(FROM) }
    });
  });

  it('returns {} when a whitelisted field has only garbage bounds', () => {
    expect(buildDateRangeFilter('marketingStartDate', 'nope', 'still-nope')).toEqual({});
  });
});
