import { parse } from 'date-fns';
import { describe, expect, test } from 'vitest';
import { computeNotificationDelay, MINUTES_BEFORE } from './interviewNotification';

const day = '2025-06-27';

// computeNotificationDelay parses the interview time in LOCAL time (via
// date-fns `parse`), so the `now` reference must be built the same way.
// Anchoring it with a UTC `Z` literal makes the test pass only on machines
// at UTC; deriving `now` from the same local-time parse keeps it
// timezone-agnostic.
function localMs(timeStr: string): number {
  return parse(`${day} ${timeStr}`, 'yyyy-MM-dd hh:mm a', new Date()).getTime();
}

describe('computeNotificationDelay', () => {
  test('schedules 35 minutes early', () => {
    // Interview at 10:00 AM, now is 60 minutes before it.
    const now = localMs('10:00 AM') - 60 * 60 * 1000;
    const delay = computeNotificationDelay(day, '10:00 AM', now);
    expect(delay).toBe((60 - MINUTES_BEFORE) * 60 * 1000);
  });

  test('immediate when less than 35 minutes away', () => {
    // Interview at 09:50 AM, now is only 20 minutes before it (< MINUTES_BEFORE).
    const now = localMs('09:50 AM') - 20 * 60 * 1000;
    const delay = computeNotificationDelay(day, '09:50 AM', now);
    expect(delay).toBe(0);
  });
});
