import { describe, it, expect } from '@jest/globals';
import moment from 'moment-timezone';
import { taskService } from '../src/services/taskService.js';

const TIMEZONE = 'America/New_York';

describe('taskService.resolveDateRange', () => {
  it('uses explicit start and end for day range when provided', () => {
    const start = moment.tz('2024-08-15T00:00:00', TIMEZONE).toISOString();
    const end = moment.tz('2024-08-16T00:00:00', TIMEZONE).toISOString();

    const { startIso, endIso, rangeUsed } = taskService.resolveDateRange('day', start, end);

    expect(startIso).toBe(start);
    expect(endIso).toBe(end);
    expect(rangeUsed).toBe('day');
  });

  it('uses explicit start and end for week range when provided', () => {
    const start = moment.tz({ year: 2024, month: 4, day: 6 }, TIMEZONE).toISOString();
    const end = moment.tz({ year: 2024, month: 4, day: 11 }, TIMEZONE).toISOString();

    const { startIso, endIso, rangeUsed } = taskService.resolveDateRange('week', start, end);

    expect(startIso).toBe(start);
    expect(endIso).toBe(end);
    expect(rangeUsed).toBe('week');
  });

  it('falls back to day range when custom input is invalid', () => {
    const { rangeUsed } = taskService.resolveDateRange('custom', 'invalid', 'range');

    expect(rangeUsed).toBe('day');
  });
});
