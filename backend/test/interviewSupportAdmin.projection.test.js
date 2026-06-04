import { describe, it, expect, jest, beforeEach } from '@jest/globals';
const mockFind = jest.fn(() => ({ sort: () => ({ skip: () => ({ limit: () => ({ toArray: async () => [] }) }) }) }));
const mockFindOne = jest.fn(async () => ({ _id: 'x', Status: 'Pending', Subject: 's' }));
const mockCountDocuments = jest.fn(async () => 0);
const auditFind = jest.fn(() => ({ sort: () => ({ toArray: async () => [] }) }));
const mockGetCollection = jest.fn((name) => name === 'taskBody'
  ? { find: mockFind, findOne: mockFindOne, countDocuments: mockCountDocuments }
  : { find: auditFind, insertOne: jest.fn(), updateOne: jest.fn() });
jest.unstable_mockModule('../src/config/database.js', () => ({ database: { getCollection: mockGetCollection } }));
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
mockLogger.child = jest.fn(() => mockLogger);
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: mockLogger }));
const svc = await import('../src/services/interviewSupportAdminService.js');
const { TASK_EXCLUDE_HEAVY } = await import('../src/models/Task.js');
beforeEach(() => jest.clearAllMocks());
describe('interviewSupportAdminService — heavy-field projection', () => {
  it('listTasks passes the projection to find', async () => {
    await svc.interviewSupportAdminService.listTasks({});
    expect(mockFind.mock.calls[0][1]).toEqual({ projection: TASK_EXCLUDE_HEAVY });
  });
  it('getTaskDetail does NOT project (needs replies + body)', async () => {
    await svc.interviewSupportAdminService.getTaskDetail('507f1f77bcf86cd799439011');
    expect(mockFindOne.mock.calls[0][1]).toBeUndefined();
  });
});
