import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mirrors backend/test/dashboardController.expertStats.test.js / .drilldown.test.js:
// mock the collection + aggregate so we can capture the pipeline that the
// controller builds, then assert the interview-date $match.

const aggregateMock = jest.fn();
const getCollectionMock = jest.fn();

await jest.resetModules();

await jest.unstable_mockModule('../src/config/database.js', () => ({
  database: {
    getCollection: getCollectionMock
  }
}));

const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
mockLogger.child = jest.fn(() => mockLogger);
await jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: mockLogger }));

const { dashboardController } = await import('../src/controllers/dashboardController.js');

const createRes = () => {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload) => {
    res.body = payload;
    return res;
  });
  return res;
};

// Recursively search a pipeline (array of stages, possibly nested in $facet)
// for the first $match whose top-level keys include `field`.
const findMatchOnField = (pipeline, field) => {
  for (const stage of pipeline || []) {
    if (stage && stage.$match && Object.prototype.hasOwnProperty.call(stage.$match, field)) {
      return stage.$match;
    }
  }
  return null;
};

// Walk every captured aggregate() call + every $facet sub-pipeline and return
// the first interviewStartAt $match found anywhere.
const findInterviewStartAtMatch = () => {
  for (const call of aggregateMock.mock.calls) {
    const pipeline = call[0];
    const direct = findMatchOnField(pipeline, 'interviewStartAt');
    if (direct) return direct;
    for (const stage of pipeline || []) {
      if (stage && stage.$facet) {
        for (const sub of Object.values(stage.$facet)) {
          const nested = findMatchOnField(sub, 'interviewStartAt');
          if (nested) return nested;
        }
      }
    }
  }
  return null;
};

// Assert NO stage anywhere parses "Date of Interview" via $dateFromString as a
// range-filter $match (the old, unindexable approach we replaced).
const serializePipelines = () =>
  JSON.stringify(aggregateMock.mock.calls.map((c) => c[0]));

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

describe('dashboardController interview-date filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Every aggregate() returns an empty result set so the controllers run to
    // completion without a live DB.
    aggregateMock.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
    getCollectionMock.mockReturnValue({ aggregate: aggregateMock });
  });

  it('getRecruiterStats: interview-date $match uses an interviewStartAt range (no $dateFromString on "Date of Interview")', async () => {
    const req = {
      query: { startDate: '2026-03-01', endDate: '2026-03-31', dateBasis: 'interview' },
      user: { email: 'admin@example.com', role: 'admin' }
    };
    const res = createRes();

    await dashboardController.getRecruiterStats(req, res);

    expect(res.status).not.toHaveBeenCalled();

    const match = findInterviewStartAtMatch();
    expect(match).not.toBeNull();
    expect(match.interviewStartAt.$gte).toBeInstanceOf(Date);
    expect(match.interviewStartAt.$lte || match.interviewStartAt.$lt).toBeInstanceOf(Date);

    // The chosen explicit range must actually be applied (was silently ignored
    // before because endDate was not threaded through).
    expect(match.interviewStartAt.$gte.toISOString().slice(0, 10)).toBe('2026-03-01');

    // No $dateFromString parse of the "Date of Interview" string as a filter.
    expect(serializePipelines()).not.toContain('Date of Interview');
  });

  it('getRecruiterStats: with NO date range supplied, defaults to a ~today range on interviewStartAt', async () => {
    const req = {
      query: { dateBasis: 'interview' }, // no period, no startDate, no endDate
      user: { email: 'admin@example.com', role: 'admin' }
    };
    const res = createRes();

    await dashboardController.getRecruiterStats(req, res);

    expect(res.status).not.toHaveBeenCalled();

    const match = findInterviewStartAtMatch();
    expect(match).not.toBeNull();

    const gte = match.interviewStartAt.$gte;
    const upper = match.interviewStartAt.$lte || match.interviewStartAt.$lt;
    expect(gte).toBeInstanceOf(Date);
    expect(upper).toBeInstanceOf(Date);

    // The default window should cover roughly one day (today, EST-anchored).
    const span = upper.getTime() - gte.getTime();
    expect(span).toBeGreaterThan(ONE_DAY_MS * 0.9);
    expect(span).toBeLessThan(ONE_DAY_MS * 1.1);

    // And it should be today's date (start-of-day === now's date), proving the
    // default is "today" rather than all-time / start-of-month.
    const today = new Date();
    expect(gte.getTime()).toBeLessThanOrEqual(today.getTime());
    expect(upper.getTime()).toBeGreaterThanOrEqual(today.getTime());
  });

  it('getOverviewStats: defaults to a ~today interviewStartAt range when no range is supplied', async () => {
    const req = {
      query: { dateBasis: 'interview' },
      user: { email: 'admin@example.com', role: 'admin' }
    };
    const res = createRes();

    await dashboardController.getOverviewStats(req, res);

    expect(res.status).not.toHaveBeenCalled();

    const match = findInterviewStartAtMatch();
    expect(match).not.toBeNull();

    const gte = match.interviewStartAt.$gte;
    const upper = match.interviewStartAt.$lte || match.interviewStartAt.$lt;
    const span = upper.getTime() - gte.getTime();
    expect(span).toBeGreaterThan(ONE_DAY_MS * 0.9);
    expect(span).toBeLessThan(ONE_DAY_MS * 1.1);

    expect(serializePipelines()).not.toContain('Date of Interview');
  });
});
