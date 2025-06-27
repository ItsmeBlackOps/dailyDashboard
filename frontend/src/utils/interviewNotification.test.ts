import { describe, expect, test } from 'vitest';
import { computeNotificationDelay, MINUTES_BEFORE } from './interviewNotification';

const day = '2025-06-27';

describe('computeNotificationDelay', () => {
  test('schedules 35 minutes early', () => {
    const now = new Date(`${day}T09:00:00Z`).getTime();
    const delay = computeNotificationDelay(day, '10:00 AM', now);
    expect(delay).toBe((60 - MINUTES_BEFORE) * 60 * 1000);
  });

  test('immediate when less than 35 minutes away', () => {
    const now = new Date(`${day}T09:30:00Z`).getTime();
    const delay = computeNotificationDelay(day, '09:50 AM', now);
    expect(delay).toBe(0);
  });
});
