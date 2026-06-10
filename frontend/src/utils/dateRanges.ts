import moment from 'moment-timezone';

export const DEFAULT_TIMEZONE = 'America/New_York';

export interface DateRangeResult {
  startIso: string;
  endIso: string;
}

export interface WeekOption extends DateRangeResult {
  index: number;
  label: string;
}

export function computeDayRange(dateInput: Date | string, timezone = DEFAULT_TIMEZONE): DateRangeResult & { dayIso: string } {
  const base = moment.tz(dateInput, timezone);
  const start = base.clone().startOf('day');
  const end = start.clone().add(1, 'day');

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    dayIso: start.toISOString(),
  };
}

export function computeWeekRange(year: number, month: number, weekIndex: number, timezone = DEFAULT_TIMEZONE): DateRangeResult {
  if (weekIndex < 1) {
    weekIndex = 1;
  }

  const monthStart = moment.tz({ year, month, day: 1 }, timezone).startOf('day');
  const firstMonday = monthStart.clone();
  while (firstMonday.isoWeekday() !== 1) {
    firstMonday.add(1, 'day');
  }

  const start = firstMonday.clone().add(weekIndex - 1, 'week');
  const end = start.clone().add(5, 'day'); // Exclusive Saturday start (Mon-Fri inclusive)

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function computeMonthRange(year: number, month: number, timezone = DEFAULT_TIMEZONE): DateRangeResult {
  const start = moment.tz({ year, month, day: 1 }, timezone).startOf('day');
  const end = start.clone().add(1, 'month');

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function generateWeekOptions(year: number, month: number, timezone = DEFAULT_TIMEZONE): WeekOption[] {
  const options: WeekOption[] = [];
  const monthStart = moment.tz({ year, month, day: 1 }, timezone).startOf('day');
  const firstMonday = monthStart.clone();

  while (firstMonday.isoWeekday() !== 1) {
    firstMonday.add(1, 'day');
  }

  let current = firstMonday.clone();
  let index = 1;

  while (current.month() === month || current.clone().add(4, 'day').month() === month) {
    const start = current.clone();
    const end = start.clone().add(5, 'day');

    const label = `Week ${index} (${start.format('MMM D')} – ${start.clone().add(4, 'day').format('MMM D')})`;

    options.push({
      index,
      label,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    });

    current = current.add(1, 'week');
    index += 1;
  }

  return options;
}

export function clampWeekIndex(index: number, options: WeekOption[]): number {
  if (options.length === 0) {
    return 1;
  }
  const found = options.find((option) => option.index === index);
  return found ? found.index : options[0].index;
}

// ── Eastern-anchored day-picker helpers ──────────────────────────────────
// The day/range Calendar hands back JS Dates at the BROWSER's local midnight.
// Passing that instant into computeDayRange re-interprets it in Eastern and can
// land on a neighbouring Eastern day (the off-by-one non-ET users saw). These
// keep the picker Eastern-consistent: take the picked wall-clock Y-M-D, anchor
// it to Eastern, and render Eastern back out.

/** A picked calendar Date (local midnight) → its wall-clock `YYYY-MM-DD`. */
export function localDateToYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Eastern day boundaries for a wall-clock `YYYY-MM-DD`. */
export function computeDayRangeFromYmd(ymd: string, timezone = DEFAULT_TIMEZONE): DateRangeResult & { dayIso: string } {
  const start = moment.tz(ymd, 'YYYY-MM-DD', timezone).startOf('day');
  const end = start.clone().add(1, 'day');
  return { startIso: start.toISOString(), endIso: end.toISOString(), dayIso: start.toISOString() };
}

/** Eastern boundaries for an inclusive `from`..`to` wall-clock day range. */
export function computeRangeFromYmd(fromYmd: string, toYmd: string, timezone = DEFAULT_TIMEZONE): DateRangeResult {
  const start = moment.tz(fromYmd, 'YYYY-MM-DD', timezone).startOf('day');
  const end = moment.tz(toYmd, 'YYYY-MM-DD', timezone).startOf('day').add(1, 'day'); // `to` inclusive
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** An Eastern-day ISO → a LOCAL Date at that day's Y-M-D, so the Calendar
 *  (which works in local time) highlights the correct cell. */
export function estDayIsoToLocalDate(iso: string, timezone = DEFAULT_TIMEZONE): Date {
  const m = moment.tz(iso, timezone);
  return new Date(m.year(), m.month(), m.date());
}

/** An Eastern-day ISO → a display label rendered in Eastern. */
export function formatEstDayLabel(iso: string, timezone = DEFAULT_TIMEZONE): string {
  return moment.tz(iso, timezone).format('MMM DD, YYYY');
}
