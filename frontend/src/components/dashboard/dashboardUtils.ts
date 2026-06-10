import type { DashboardFilterState } from './DashboardFilters';

export function buildDashboardPayload(filters: DashboardFilterState) {
  const payload: Record<string, string | boolean> = {
    range: filters.range,
    dateField: filters.dateField,
  };

  // start/end are already Eastern-anchored ISO instants — the picker anchors
  // both single-day and custom ranges to America/New_York via the dateRanges
  // helpers — so pass them through verbatim. (Previously the custom branch
  // re-derived day boundaries with date-fns in the BROWSER's timezone, which
  // shifted custom ranges off by a day for non-Eastern users.)
  if (filters.start) {
    payload.start = filters.start;
  }
  if (filters.end) {
    payload.end = filters.end;
  }

  if (filters.upcoming) {
    payload.upcoming = true;
  }

  return payload;
}
