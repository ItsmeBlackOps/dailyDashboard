import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const aggregateMock = jest.fn();
const getCollectionMock = jest.fn();

await jest.resetModules();

await jest.unstable_mockModule('../src/config/database.js', () => ({
  database: {
    getCollection: getCollectionMock
  }
}));

await jest.unstable_mockModule('../src/utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn()
  }
}));

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

describe('dashboardController drilldown filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCollectionMock.mockReturnValue({
      aggregate: aggregateMock
    });
  });

  it('applies recruiter drilldown filters for status and rounds', async () => {
    const toArrayMock = jest.fn().mockResolvedValue([]);
    aggregateMock.mockReturnValueOnce({ toArray: toArrayMock });

    const req = {
      query: {
        period: 'day',
        recruiterEmail: 'recruiter@example.com',
        status: 'completed',
        interviewRound: 'Round 1',
        actualRound: 'Loop',
        viewMode: 'owner'
      },
      user: { email: 'admin@example.com', role: 'admin' }
    };
    const res = createRes();

    await dashboardController.getRecruiterDrilldown(req, res);

    const pipeline = aggregateMock.mock.calls[0][0];
    expect(pipeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ $match: expect.objectContaining({ recruiterEmailLower: 'recruiter@example.com' }) }),
      expect.objectContaining({ $match: expect.objectContaining({ statusLower: { $in: ['completed', 'done'] } }) }),
      expect.objectContaining({ $match: expect.objectContaining({ interviewRoundLower: 'round 1' }) }),
      expect.objectContaining({ $match: expect.objectContaining({ actualRoundLower: 'loop' }) })
    ]));
  });

  it('applies expert drilldown filters for status and rounds', async () => {
    const toArrayMock = jest.fn().mockResolvedValue([]);
    aggregateMock.mockReturnValueOnce({ toArray: toArrayMock });

    const req = {
      query: {
        period: 'day',
        expertEmail: 'Expert@Example.com',
        status: 'pending',
        interviewRound: 'Round 2',
        actualRound: 'Actual 1'
      },
      user: { email: 'admin@example.com', role: 'admin' }
    };
    const res = createRes();

    await dashboardController.getExpertDrilldown(req, res);

    const pipeline = aggregateMock.mock.calls[0][0];
    expect(pipeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ $match: expect.objectContaining({ assignedExpertLower: 'expert@example.com' }) }),
      expect.objectContaining({ $match: expect.objectContaining({ statusLower: 'pending' }) }),
      expect.objectContaining({ $match: expect.objectContaining({ interviewRoundLower: 'round 2' }) }),
      expect.objectContaining({ $match: expect.objectContaining({ actualRoundLower: 'actual 1' }) })
    ]));
  });
});
