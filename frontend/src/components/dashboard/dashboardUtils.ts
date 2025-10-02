import { endOfDay, startOfDay } from 'date-fns';
import type { DashboardFilterState } from './DashboardFilters';

export function buildDashboardPayload(filters: DashboardFilterState) {
  const payload: Record<string, string | boolean> = {
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

  if (filters.upcoming) {
    payload.upcoming = true;
  }

  return payload;
}
