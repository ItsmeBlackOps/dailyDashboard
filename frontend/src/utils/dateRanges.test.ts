import { describe, it, expect } from 'vitest';
import {
  computeDayRange,
  computeWeekRange,
  computeMonthRange,
  generateWeekOptions,
  clampWeekIndex,
  DEFAULT_TIMEZONE,
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
