import { describe, it, expect } from 'vitest';
import { buildDashboardPayload } from '../dashboardUtils';
import type { DashboardFilterState } from '../DashboardFilters';

// The day picker emits Eastern-anchored ISO instants. June 9 2026 (EDT, UTC-4):
// start = 2026-06-09 00:00 ET, end = 2026-06-10 00:00 ET.
const DAY_START = '2026-06-09T04:00:00.000Z';
const DAY_END = '2026-06-10T04:00:00.000Z';

const dayFilters: DashboardFilterState = {
  range: 'day',
  dateField: 'Date of Interview',
  dayDate: DAY_START,
  start: DAY_START,
  end: DAY_END,
  upcoming: false,
};

describe('buildDashboardPayload', () => {
  // Regression for the Tasks-tab day filter: a PICKED day keeps range==='day',
  // so the payload MUST carry that day's Eastern start/end. TasksToday used to
  // strip start/end whenever range==='day' and let the backend recompute
  // "today", which made every non-today pick silently return today's tasks.
  it('ships the picked day\'s Eastern start/end for the "day" preset', () => {
    const payload = buildDashboardPayload(dayFilters);
    expect(payload.range).toBe('day');
    expect(payload.start).toBe(DAY_START);
    expect(payload.end).toBe(DAY_END);
  });

  it('ships start/end for week / month / custom presets too', () => {
    for (const range of ['week', 'month', 'custom'] as const) {
      const payload = buildDashboardPayload({ ...dayFilters, range });
      expect(payload.start).toBe(DAY_START);
      expect(payload.end).toBe(DAY_END);
    }
  });

  it('omits start/end when absent and flags upcoming', () => {
    const payload = buildDashboardPayload({
      range: 'day',
      dateField: 'Date of Interview',
      upcoming: true,
    });
    expect(payload.start).toBeUndefined();
    expect(payload.end).toBeUndefined();
    expect(payload.upcoming).toBe(true);
  });
});
