import { describe, it, expect } from 'vitest';
import {
  computeDayRange,
  computeWeekRange,
  computeMonthRange,
  generateWeekOptions,
  clampWeekIndex,
  DEFAULT_TIMEZONE,
  localDateToYmd,
  computeDayRangeFromYmd,
  computeRangeFromYmd,
  estDayIsoToLocalDate,
  formatEstDayLabel,
} from './dateRanges';

const tz = DEFAULT_TIMEZONE;

describe('date range utilities', () => {
  it('computes day range boundaries', () => {
    const { startIso, endIso, dayIso } = computeDayRange('2024-05-10', tz);

    expect(startIso).toMatch(/2024-05-10/);
    expect(endIso).toMatch(/2024-05-11/);
    expect(dayIso).toBe(startIso);
  });

  it('computes week range for a given index', () => {
    const { startIso, endIso } = computeWeekRange(2024, 4, 2, tz);

    expect(startIso).toBeDefined();
    expect(endIso).toBeDefined();
    expect(startIso < endIso).toBe(true);
  });

  it('computes month range boundaries', () => {
    const { startIso, endIso } = computeMonthRange(2024, 6, tz);

    expect(startIso).toMatch(/2024-07-01/);
    expect(endIso).toMatch(/2024-08-01/);
  });

  it('generates week options with consistent indices', () => {
    const options = generateWeekOptions(2024, 4, tz);
    const indices = options.map((option) => option.index);

    expect(indices[0]).toBe(1);
    expect(new Set(indices).size).toBe(indices.length);
    expect(options.every((option) => option.label.startsWith('Week '))).toBe(true);
  });

  it('clamps week index to available options', () => {
    const options = generateWeekOptions(2024, 4, tz);
    const invalidIndex = 99;

    const resolved = clampWeekIndex(invalidIndex, options);

    expect(options.some((option) => option.index === resolved)).toBe(true);
  });
});

describe('Eastern-anchored day-picker helpers', () => {
  it('localDateToYmd uses the picked wall-clock day', () => {
    // new Date(y, monthIndex, d) is local midnight; getFullYear/Month/Date
    // return those same components regardless of the host timezone.
    expect(localDateToYmd(new Date(2026, 5, 9))).toBe('2026-06-09'); // June = index 5
  });

  it('computeDayRangeFromYmd anchors the picked day to Eastern (June = EDT, UTC-4)', () => {
    const { startIso, endIso, dayIso } = computeDayRangeFromYmd('2026-06-09', tz);
    expect(startIso).toBe('2026-06-09T04:00:00.000Z'); // EDT midnight = 04:00 UTC
    expect(endIso).toBe('2026-06-10T04:00:00.000Z');
    expect(dayIso).toBe(startIso);
  });

  it('computeRangeFromYmd makes the `to` day inclusive', () => {
    const { startIso, endIso } = computeRangeFromYmd('2026-06-09', '2026-06-11', tz);
    expect(startIso).toBe('2026-06-09T04:00:00.000Z');
    expect(endIso).toBe('2026-06-12T04:00:00.000Z'); // through the end of the 11th
  });

  it('estDayIsoToLocalDate maps an Eastern day back to its Y-M-D', () => {
    const local = estDayIsoToLocalDate('2026-06-09T04:00:00.000Z', tz);
    expect(local.getFullYear()).toBe(2026);
    expect(local.getMonth()).toBe(5); // June
    expect(local.getDate()).toBe(9);
  });

  it('formatEstDayLabel renders the Eastern day', () => {
    expect(formatEstDayLabel('2026-06-09T04:00:00.000Z', tz)).toBe('Jun 09, 2026');
  });
});
