/* @vitest-environment node */
import { describe, it, expect } from 'vitest';
import moment from 'moment-timezone';

import { resolveDateRange } from '../DateRangeFilter';

const TZ = 'America/New_York';

/**
 * `resolveDateRange` translates a named preset into a pair of UTC ISO instants
 * that bound an Eastern-time calendar range. The backend stores dates as UTC
 * instants and filters with `{ [dateField]: { $gte: dateFrom, $lt: dateTo } }`,
 * so the boundaries we emit must be the UTC instants of Eastern midnights.
 *
 * We assert one clean property per preset and deliberately do NOT probe the
 * DST transition — the helper leans on moment-timezone for that and a single
 * non-DST assertion keeps the test stable.
 */
describe('resolveDateRange', () => {
  it('today → dateFrom/dateTo exactly 24h apart, dateFrom is Eastern midnight', () => {
    const { dateFrom, dateTo } = resolveDateRange('today', TZ);

    expect(dateFrom).toBeTruthy();
    expect(dateTo).toBeTruthy();

    // The lower bound, read back in Eastern time, is start-of-day (00:00).
    expect(moment.tz(dateFrom as string, TZ).format('HH:mm')).toBe('00:00');

    // today spans exactly one day → the two instants are 24h apart.
    const hours = moment(dateTo as string).diff(moment(dateFrom as string), 'hours', true);
    expect(hours).toBe(24);
  });

  it('month → spans exactly one calendar month and starts at Eastern month-start', () => {
    const { dateFrom, dateTo } = resolveDateRange('month', TZ);

    expect(dateFrom).toBeTruthy();
    expect(dateTo).toBeTruthy();

    const from = moment.tz(dateFrom as string, TZ);
    const to = moment.tz(dateTo as string, TZ);

    // Lower bound is the first instant of the current Eastern month.
    expect(from.format('HH:mm')).toBe('00:00');
    expect(from.date()).toBe(1);

    // Upper bound is the first instant of the next Eastern month.
    expect(to.date()).toBe(1);
    expect(to.isSame(from.clone().add(1, 'month'), 'day')).toBe(true);
  });

  it('all → empty object (no date filter)', () => {
    expect(resolveDateRange('all', TZ)).toEqual({});
  });
});
