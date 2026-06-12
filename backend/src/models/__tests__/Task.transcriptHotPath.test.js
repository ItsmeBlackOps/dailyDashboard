import { jest } from '@jest/globals';

// Task.js pulls a wide import graph — mock the I/O edges so the model
// instance constructs offline. Only the hot-path helpers are exercised.
jest.unstable_mockModule('../../config/database.js', () => ({
  database: { getCollection: () => null },
}));
jest.unstable_mockModule('../../config/index.js', () => ({
  config: {
    appwrite: { endpoint: '', projectId: '', apiKey: '', databaseId: '', transcriptsCollectionId: '' },
    server: { env: 'test' },
  },
}));
jest.unstable_mockModule('../../utils/logger.js', () => {
  const mockLogger = {
    info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn(),
  };
  mockLogger.child = jest.fn(() => mockLogger);
  return {
    logger: mockLogger,
    createTimer: jest.fn(() => ({ end: jest.fn() })),
    posthogLogger: { emit: jest.fn() },
  };
});

const { taskModel } = await import('../Task.js');

describe('applyPersistedTranscriptFlags', () => {
  it('maps transcription strictly from the persisted boolean', () => {
    const out = taskModel.applyPersistedTranscriptFlags([
      { subject: 'A', transcription: true },
      { subject: 'B', transcription: false },
      { subject: 'C' },
      { subject: 'D', transcription: 'yes' }, // truthy junk is NOT trusted
    ]);
    expect(out.map((t) => t.transcription)).toEqual([true, false, false, false]);
  });

  it('tolerates empty/null input', () => {
    expect(taskModel.applyPersistedTranscriptFlags([])).toEqual([]);
    expect(taskModel.applyPersistedTranscriptFlags(null)).toEqual([]);
  });
});

describe('queueTranscriptDiscovery', () => {
  afterEach(() => {
    taskModel._transcriptDiscoveryInFlight = false;
  });

  it('kicks discovery WITHOUT awaiting it (hot path returns immediately)', () => {
    let resolveEnrich;
    taskModel.enrichWithTranscriptStatus = jest.fn(
      () => new Promise((resolve) => { resolveEnrich = resolve; })
    );

    const before = Date.now();
    taskModel.queueTranscriptDiscovery([{ subject: 'Pending interview', transcription: false }]);
    const elapsed = Date.now() - before;

    expect(taskModel.enrichWithTranscriptStatus).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeLessThan(50); // returned synchronously, enrich unresolved
    resolveEnrich([]);
  });

  it('skips when every task is already flagged', () => {
    taskModel.enrichWithTranscriptStatus = jest.fn(async () => []);
    taskModel.queueTranscriptDiscovery([
      { subject: 'Done A', transcription: true },
      { subject: 'Done B', transcription: true },
    ]);
    expect(taskModel.enrichWithTranscriptStatus).not.toHaveBeenCalled();
  });

  it('runs at most one sweep at a time', () => {
    taskModel.enrichWithTranscriptStatus = jest.fn(() => new Promise(() => {}));
    taskModel.queueTranscriptDiscovery([{ subject: 'X', transcription: false }]);
    taskModel.queueTranscriptDiscovery([{ subject: 'Y', transcription: false }]);
    expect(taskModel.enrichWithTranscriptStatus).toHaveBeenCalledTimes(1);
  });
});
