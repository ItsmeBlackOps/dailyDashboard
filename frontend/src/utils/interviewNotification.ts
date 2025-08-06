import { parse } from 'date-fns';

export const MINUTES_BEFORE = 35;

export function computeNotificationDelay(dateStr: string, timeStr: string, now: number = Date.now()): number {
  try {
    const parsed = parse(`${dateStr} ${timeStr}`, 'yyyy-MM-dd hh:mm a', new Date());
    const diff = parsed.getTime() - now;
    return diff > MINUTES_BEFORE * 60 * 1000 ? diff - MINUTES_BEFORE * 60 * 1000 : 0;
  } catch {
    return 0;
  }
}
