import { jest } from '@jest/globals';

const debriefSvc = {
  getCachedContent: jest.fn(async () => null),
  enqueueDebriefGeneration: jest.fn(() => ({ status: 'queued' })),
  getJobState: jest.fn(() => null),
};

let baselineDoc = null;          // schedulerLocks doc for the baseline marker
let leaseAcquired = true;
let queuedTasks = [];            // results for the 'autoDebrief.status: queued' sweep
let newTasks = [];               // results for the new-candidates scan
const taskUpdates = [];
const claims = [];
let baselineUpdateManyArgs = null;

const fakeTaskCol = {
  find: jest.fn((query) => {
    const results = query?.['autoDebrief.status'] === 'queued' ? queuedTasks : newTasks;
    const chain = {
      sort: () => chain,
      limit: () => chain,
      toArray: async () => results,
    };
    return chain;
  }),
  findOne: jest.fn(async (q) => newTasks.find(t => String(t._id) === String(q._id)) || null),
  findOneAndUpdate: jest.fn(async (filter, update) => {
    claims.push([filter, update]);
    return { _id: filter._id }; // claim wins (driver v6 returns the doc)
  }),
  updateOne: jest.fn(async (...a) => { taskUpdates.push(a); return { matchedCount: 1 }; }),
  updateMany: jest.fn(async (...a) => { baselineUpdateManyArgs = a; return { modifiedCount: 3 }; }),
};

const fakeLockCol = {
  findOne: jest.fn(async (q) => (q._id === 'transcriptAutoGenBaseline' ? baselineDoc : null)),
  insertOne: jest.fn(async (doc) => { baselineDoc = doc; }),
  findOneAndUpdate: jest.fn(async () => (leaseAcquired ? { owner: 'me' } : null)),
};

jest.unstable_mockModule('../../services/interviewDebriefService.js', () => ({
  interviewDebriefService: debriefSvc,
}));
jest.unstable_mockModule('../../config/database.js', () => ({
  database: {
    getDb: () => ({
      collection: (name) => (name === 'schedulerLocks' ? fakeLockCol : fakeTaskCol),
    }),
  },
}));
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { _tick } = await import('../transcriptAutoGenScheduler.js');

const freshTask = (id, overrides = {}) => ({
  _id: id,
  'Candidate Name': 'Test Candidate',
  subject: `Interview Support - ${id}`,
  transcription: true,
  transcriptionDetectedAt: new Date(),
  interviewStartAt: new Date(),
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  baselineDoc = { _id: 'transcriptAutoGenBaseline', at: new Date(Date.now() - 86_400_000) };
  leaseAcquired = true;
  queuedTasks = [];
  newTasks = [];
  taskUpdates.length = 0;
  claims.length = 0;
  baselineUpdateManyArgs = null;
  debriefSvc.getCachedContent.mockResolvedValue(null);
  debriefSvc.getJobState.mockReturnValue(null);
});

describe('transcriptAutoGenScheduler tick', () => {
  it('does nothing when the lease is held by another instance', async () => {
    leaseAcquired = false;
    newTasks = [freshTask('t1')];

    await _tick();

    expect(fakeTaskCol.find).not.toHaveBeenCalled();
    expect(debriefSvc.enqueueDebriefGeneration).not.toHaveBeenCalled();
  });

  it('first run establishes the baseline (marks pre-flagged tasks, generates nothing)', async () => {
    baselineDoc = null; // no baseline yet

    await _tick();

    expect(baselineUpdateManyArgs[0]).toEqual({ transcription: true, autoDebrief: { $exists: false } });
    expect(baselineUpdateManyArgs[1].$set.autoDebrief.status).toBe('baseline');
    expect(fakeLockCol.insertOne).toHaveBeenCalled();
    expect(debriefSvc.enqueueDebriefGeneration).not.toHaveBeenCalled();
  });

  it('claims a newly transcribed task and queues debrief generation', async () => {
    newTasks = [freshTask('t1')];

    await _tick();

    expect(claims.length).toBe(1);
    expect(claims[0][0]).toEqual({ _id: 't1', autoDebrief: { $exists: false } });
    expect(claims[0][1].$set.autoDebrief.status).toBe('queued');
    expect(debriefSvc.enqueueDebriefGeneration).toHaveBeenCalledWith(
      't1', expect.objectContaining({ _id: 't1' }), 'transcript-autogen', false);
  });

  it('marks a task generated without enqueueing when the debrief is already cached', async () => {
    newTasks = [freshTask('t1')];
    debriefSvc.getCachedContent.mockResolvedValue({ content: '# cached' });

    await _tick();

    expect(debriefSvc.enqueueDebriefGeneration).not.toHaveBeenCalled();
    const marked = taskUpdates.find(([, u]) => u.$set?.autoDebrief?.status === 'generated');
    expect(marked).toBeTruthy();
    expect(marked[1].$set.autoDebrief.cached).toBe(true);
  });

  it('sweep flips a queued task to generated once its cache appears', async () => {
    queuedTasks = [{ _id: 'q1', autoDebrief: { status: 'queued', at: new Date() } }];
    debriefSvc.getCachedContent.mockResolvedValue({ content: '# done' });

    await _tick();

    const marked = taskUpdates.find(([, u]) => u.$set?.autoDebrief?.status === 'generated');
    expect(marked).toBeTruthy();
  });

  it('sweep retries a failed generation once, then marks it failed', async () => {
    queuedTasks = [{ _id: 'q1', autoDebrief: { status: 'queued', at: new Date(), retries: 1 } }];
    debriefSvc.getJobState.mockReturnValue({ status: 'failed', error: 'boom' });

    await _tick();

    expect(debriefSvc.enqueueDebriefGeneration).not.toHaveBeenCalled();
    const failed = taskUpdates.find(([, u]) => u.$set?.autoDebrief?.status === 'failed');
    expect(failed).toBeTruthy();
    expect(failed[1].$set.autoDebrief.error).toBe('boom');
  });
});
