import { endOfDay, startOfDay } from 'date-fns';
import type { DashboardFilterState } from './DashboardFilters';

/**
 * Builds a query payload object from dashboard filter state.
 *
 * When `filters.range` is `'custom'`, `start` and `end` (if present) are converted to ISO strings at the start and end of their respective days; otherwise `start` and `end` are copied as provided.
 *
 * @param filters - Dashboard filter settings; expected to include `range`, `dateField`, and optional `start`/`end` values
 * @returns A record containing `range` and `dateField`, and optional `start` and `end` string values suitable for use in requests
 */
export function buildDashboardPayload(filters: DashboardFilterState) {
  const payload: Record<string, string> = {
    range: filters.range,
    dateField: filters.dateField,
  };

  if (filters.range === 'custom') {
    if (filters.start) {
      payload.start = startOfDay(new Date(filters.start)).toISOString();
    }
    if (filters.end) {
      payload.end = endOfDay(new Date(filters.end)).toISOString();
    }
  } else {
    if (filters.start) {
      payload.start = filters.start;
    }
    if (filters.end) {
      payload.end = filters.end;
    }
  }

  return payload;
}
