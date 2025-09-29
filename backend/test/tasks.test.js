import { describe, it, beforeAll, afterAll, expect, jest } from '@jest/globals';
import { setupSocketTestHarness, SOCKET_TEST_CONFIG } from './helpers/socketTestHarness.js';

jest.setTimeout(90000);

describe('Socket Task Queries', () => {
  let harness;
  let emit;
  let loginResponse;

  beforeAll(async () => {
    harness = await setupSocketTestHarness();
    emit = harness.emitWithAck;

    loginResponse = await emit('login', SOCKET_TEST_CONFIG.credentials, 20000);
    expect(loginResponse.success).toBe(true);
  });

  afterAll(async () => {
    if (loginResponse?.refreshToken && emit) {
      await emit('logout', { refreshToken: loginResponse.refreshToken });
    }
    if (harness) {
      await harness.shutdown();
    }
  });

  it('responds to ping', async () => {
    const response = await emit('ping', undefined, 5000);
    expect(response.success).toBe(true);
    expect(response.socketId).toBeDefined();
    expect(new Date(response.timestamp).toString()).not.toBe('Invalid Date');
  });

  it('returns authenticated user info', async () => {
    const response = await emit('getUserInfo', undefined, 5000);
    expect(response.success).toBe(true);
    expect(response.authenticated).toBe(true);
    expect(response.user).toMatchObject({
      email: SOCKET_TEST_CONFIG.credentials.email,
      role: 'admin',
      teamLead: 'Lead A',
      manager: 'Manager A'
    });
  });

  it('retrieves today\'s tasks metadata', async () => {
    const response = await emit('getTasksToday', { tab: 'Date of Interview' }, 60000);
    expect(response.success).toBe(true);
    expect(Array.isArray(response.tasks)).toBe(true);
    expect(response.meta).toMatchObject({
      tab: 'Date of Interview',
      userRole: 'admin'
    });
    expect(typeof response.meta.count).toBe('number');

    if (response.tasks.length > 0) {
      expect(response.tasks[0]).not.toHaveProperty('body');
      expect(response.tasks[0]).not.toHaveProperty('replies');
      expect(typeof response.tasks[0].transcription).toBe('boolean');
    }
  });

  it('provides dashboard summary for a date range', async () => {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);

    const response = await emit('getDashboardSummary', {
      range: 'custom',
      start: start.toISOString(),
      end: end.toISOString(),
      dateField: 'Date of Interview'
    }, 60000);

    expect(response.success).toBe(true);
    expect(Array.isArray(response.summary)).toBe(true);
    expect(response.meta).toMatchObject({
      userRole: 'admin'
    });
    const { kpi } = response.meta;
    expect(kpi).toBeDefined();
    expect(typeof kpi.totals.overall).toBe('number');
    expect(kpi.totals.byRound).toBeDefined();
    expect(kpi.received).toHaveProperty('today');
    expect(kpi.received).toHaveProperty('thisWeek');
    expect(kpi.received).toHaveProperty('thisMonth');
    expect(kpi.interview).toHaveProperty('today');
    expect(kpi.interview).toHaveProperty('thisWeek');
    expect(kpi.interview).toHaveProperty('thisMonth');
    expect(kpi.branch).toBeDefined();
    expect(response.meta.leaders).toBeDefined();
    expect(Array.isArray(response.meta.leaders.expert)).toBe(true);
    expect(response.meta.dateRange).toMatchObject({
      startIso: expect.any(String),
      endIso: expect.any(String),
      range: 'custom'
    });
  });

  it('searches tasks with filters', async () => {
    const response = await emit('searchTasks', {
      search: 'interview',
      limit: 5
    }, 60000);

    expect(response.success).toBe(true);
    expect(Array.isArray(response.tasks)).toBe(true);
    expect(response.meta).toMatchObject({
      limit: 5,
      searchCriteria: {
        search: 'interview',
        limit: 5
      }
    });

    if (response.tasks.length > 0) {
      expect(response.tasks[0]).not.toHaveProperty('body');
      expect(response.tasks[0]).not.toHaveProperty('replies');
    }
  });

  it('returns task statistics for the last week', async () => {
    const now = new Date();
    const oneWeekAgo = new Date(now);
    oneWeekAgo.setDate(now.getDate() - 7);

    const response = await emit('getTaskStatistics', {
      start: oneWeekAgo.toISOString(),
      end: now.toISOString()
    }, 60000);

    expect(response.success).toBe(true);
    expect(typeof response.statistics.totalCandidates).toBe('number');
    expect(response.statistics.statusBreakdown).toBeDefined();
    expect(Array.isArray(response.statistics.statusDistribution)).toBe(true);
    expect(response.meta.dateRange).toMatchObject({
      startDate: oneWeekAgo.toISOString(),
      endDate: now.toISOString()
    });
  });
  });
