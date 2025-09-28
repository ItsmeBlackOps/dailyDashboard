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
