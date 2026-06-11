import { jest } from '@jest/globals';

jest.unstable_mockModule('../../config/index.js', () => ({
  config: {
    appwrite: { databaseId: 'db', transcriptsCollectionId: 'tr', endpoint: '', projectId: '', apiKey: '' },
  },
}));
jest.unstable_mockModule('../../config/database.js', () => ({
  database: { getCollection: jest.fn(), getDb: jest.fn() },
}));
jest.unstable_mockModule('../../utils/logger.js', () => {
  const mkLogger = () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: () => mkLogger(),
  });
  return { logger: mkLogger() };
});
jest.unstable_mockModule('../../utils/posthogLogger.js', () => ({
  posthogLogger: { emit: jest.fn() },
}));
jest.unstable_mockModule('node-appwrite', () => ({
  Client: class { setEndpoint() { return this; } setProject() { return this; } setKey() { return this; } },
  Databases: class {},
  Query: { equal: (field, values) => ({ field, values }) },
}));

const { taskModel } = await import('../Task.js');

const listDocuments = jest.fn();
const updateMany = jest.fn(async () => ({ modifiedCount: 2 }));

beforeEach(() => {
  jest.clearAllMocks();
  taskModel.appwriteDatabases = { listDocuments };
  taskModel.collection = { updateMany };
});

describe('enrichWithTranscriptStatus with persisted flags', () => {
  it('skips Appwrite entirely when every task is already flagged', async () => {
    const tasks = [
      { _id: '1', subject: 'A', transcription: true },
      { _id: '2', subject: 'B', transcription: true },
    ];

    const out = await taskModel.enrichWithTranscriptStatus(tasks);

    expect(listDocuments).not.toHaveBeenCalled();
    expect(out.every(t => t.transcription === true)).toBe(true);
  });

  it('queries only unflagged subjects and persists newly detected ones', async () => {
    const tasks = [
      { _id: '1', subject: 'Known', transcription: true },
      { _id: '2', subject: 'Fresh' },
      { _id: '3', subject: 'Missing' },
    ];
    listDocuments.mockResolvedValue({ documents: [{ title: 'Fresh' }] });

    const out = await taskModel.enrichWithTranscriptStatus(tasks);

    // only the unflagged subjects went to Appwrite
    const queried = listDocuments.mock.calls[0][2][0].values;
    expect(queried).toEqual(['Fresh', 'Missing']);

    // the newly matched subject was persisted with the detection timestamp
    expect(updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = updateMany.mock.calls[0];
    expect(filter.$or[0].subject.$in).toEqual(['Fresh']);
    expect(update.$set.transcription).toBe(true);
    expect(update.$set.transcriptionDetectedAt).toBeInstanceOf(Date);

    expect(out.find(t => t._id === '1').transcription).toBe(true);
    expect(out.find(t => t._id === '2').transcription).toBe(true);
    expect(out.find(t => t._id === '3').transcription).toBe(false);
  });

  it('keeps persisted flags on the Appwrite error path instead of zeroing them', async () => {
    const tasks = [
      { _id: '1', subject: 'Known', transcription: true },
      { _id: '2', subject: 'Fresh' },
    ];
    listDocuments.mockRejectedValue(new Error('appwrite down'));

    const out = await taskModel.enrichWithTranscriptStatus(tasks);

    expect(out.find(t => t._id === '1').transcription).toBe(true);
    expect(out.find(t => t._id === '2').transcription).toBe(false);
  });

  it('keeps persisted flags when Appwrite is not configured', async () => {
    taskModel.appwriteDatabases = null;
    const tasks = [{ _id: '1', subject: 'Known', transcription: true }];

    const out = await taskModel.enrichWithTranscriptStatus(tasks);

    expect(out[0].transcription).toBe(true);
  });
});
