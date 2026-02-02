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

describe('dashboardController.getExpertStats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getCollectionMock.mockReturnValue({
      aggregate: aggregateMock
    });
  });

  it('adds acknowledgedShare to expert stats response', async () => {
    const toArrayMock = jest.fn().mockResolvedValue([
      {
        _id: 'expert@example.com',
        totalTasks: 10,
        completedTasks: 4,
        activeBucket: 6,
        details: {
          completed: 4,
          cancelled: 1,
          rescheduled: 0,
          assigned: 2,
          acknowledged: 7,
          pending: 1,
          notDone: 1
        },
        rounds: ['Round 1', 'Round 1', 'Round 2']
      }
    ]);
    aggregateMock.mockReturnValueOnce({ toArray: toArrayMock });

    const req = {
      query: { period: 'day' },
      user: { email: 'admin@example.com', role: 'admin' }
    };
    const res = createRes();

    await dashboardController.getExpertStats(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].acknowledgedShare).toBe(70);
    expect(res.body.data[0].roundCounts).toEqual({ 'Round 1': 2, 'Round 2': 1 });
  });
});
