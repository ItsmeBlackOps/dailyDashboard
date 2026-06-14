import { jest } from '@jest/globals';

// In-memory mockRequests store driving the model mock.
const store = new Map();
let idSeq = 1;

const modelMock = {
  create: jest.fn(async (doc) => {
    const idStr = `m${idSeq++}`;            // computed ONCE — stable id
    const _id = { toString: () => idStr };
    const full = { _id, ...doc };
    store.set(idStr, full);
    return full;
  }),
  getById: jest.fn(async (id) => store.get(String(id)) || null),
  list: jest.fn(async () => Array.from(store.values())),
  update: jest.fn(async (id, set) => {
    const cur = store.get(String(id));
    if (cur) store.set(String(id), { ...cur, ...set });
    return { matchedCount: cur ? 1 : 0 };
  }),
  transition: jest.fn(async (id, fromStatuses, set, push) => {
    const cur = store.get(String(id));
    if (!cur || !fromStatuses.includes(cur.status)) return { matchedCount: 0 };
    const next = { ...cur, ...set };
    if (push) {
      for (const [k, v] of Object.entries(push)) {
        next[k] = [...(cur[k] || []), v];
      }
    }
    store.set(String(id), next);
    return { matchedCount: 1 };
  }),
};

jest.unstable_mockModule('../../models/MockRequest.js', () => ({
  mockRequestModel: modelMock,
  DEFAULT_CHECKLIST: [
    { id: 'resume', label: 'Resume walkthrough' },
    { id: 'core', label: 'Core technical Q&A' },
  ],
  MOCK_STATUSES: [],
}));

const candidateDoc = {
  _id: { toString: () => 'cand1' },
  'Candidate Name': 'Ananya Iyer',
  'Email ID': 'ananya@x.com',
  Expert: 'aditya.sharma@vizvainc.com',
  Recruiter: 'aditya.singh@vizvainc.com',
  Technology: 'Data Engineer',
  status: 'Active',
};
jest.unstable_mockModule('../../models/Candidate.js', () => ({
  candidateModel: {
    collection: {
      findOne: jest.fn(async () => candidateDoc),
      find: jest.fn(() => ({ project: () => ({}), limit: () => ({ toArray: async () => [] }), toArray: async () => [] })),
    },
    getCandidateById: jest.fn(async () => candidateDoc),
  },
}));

const usersById = new Map([
  ['aditya.sharma@vizvainc.com', { email: 'aditya.sharma@vizvainc.com', role: 'expert', team: 'technical', teamLead: 'Prateek Narvariya', active: true }],
  ['aditya.singh@vizvainc.com', { email: 'aditya.singh@vizvainc.com', role: 'recruiter', team: 'marketing', teamLead: 'Shashank Sharma', active: true }],
  ['prateek.narvariya@silverspaceinc.com', { email: 'prateek.narvariya@silverspaceinc.com', role: 'lead', team: 'technical', teamLead: null, active: true }],
]);
jest.unstable_mockModule('../../models/User.js', () => ({
  userModel: {
    cache: usersById,
    getUserByEmail: (e) => usersById.get((e || '').toLowerCase()) || null,
  },
}));

jest.unstable_mockModule('../../config/database.js', () => ({
  database: { getCollection: () => ({ find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }) }) },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// notificationService is lazy-imported by notify/notifyWatchers.
jest.unstable_mockModule('../notificationService.js', () => ({
  notificationService: { createNotification: jest.fn(async () => ({})), broadcastToWatchers: jest.fn(async () => ({})) },
}));

const { mockRequestService } = await import('../mockRequestService.js');

const LEAD = { email: 'prateek.narvariya@silverspaceinc.com', role: 'lead', team: 'technical' };
const EXPERT = { email: 'aditya.sharma@vizvainc.com', role: 'expert', team: 'technical' };
const RECRUITER = { email: 'aditya.singh@vizvainc.com', role: 'recruiter', team: 'marketing' };
const STRANGER = { email: 'someone@vizvainc.com', role: 'expert', team: 'technical' };

beforeEach(() => {
  store.clear();
  idSeq = 1;
  jest.clearAllMocks();
});

async function makeMock() {
  return mockRequestService.create(LEAD, { candidateId: 'cand1', role: 'Data Engineer' });
}

describe('create', () => {
  it('lead creates: expert prefilled from candidate, watchers include expert + recruiter + lead, default checklist seeded', async () => {
    const mock = await makeMock();
    expect(mock.status).toBe('requested');
    expect(mock.expertEmail).toBe('aditya.sharma@vizvainc.com');
    expect(mock.watchers).toEqual(expect.arrayContaining([
      'aditya.sharma@vizvainc.com', 'aditya.singh@vizvainc.com', 'prateek.narvariya@silverspaceinc.com',
    ]));
    expect(mock.checklist.length).toBeGreaterThan(0);
    expect(mock.checklist[0]).toMatchObject({ done: false });
    expect(mock.statusHistory[0]).toMatchObject({ to: 'requested' });
  });

  it('an expert (non-lead) cannot create', async () => {
    await expect(mockRequestService.create(EXPERT, { candidateId: 'cand1' }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('caps linked interview references at 10', async () => {
    const many = Array.from({ length: 11 }, (_, i) => `t${i}`);
    await expect(mockRequestService.create(LEAD, { candidateId: 'cand1', linkedTaskIds: many }))
      .rejects.toThrow(/at most 10/);
  });
});

describe('status machine', () => {
  it('walks requested → in_progress → scheduling → scheduled → connected → completed', async () => {
    const m = await makeMock();
    const id = m._id.toString();

    await mockRequestService.start(EXPERT, id);
    expect((await modelMock.getById(id)).status).toBe('in_progress');

    await mockRequestService.logCallAttempt(EXPERT, id, { outcome: 'no_answer', note: 'shift' });
    expect((await modelMock.getById(id)).status).toBe('scheduling');

    await mockRequestService.schedule(EXPERT, id, { scheduledAt: '2026-06-13T21:00:00Z' });
    const scheduled = await modelMock.getById(id);
    expect(scheduled.status).toBe('scheduled');
    expect(scheduled.scheduledAt).toBeInstanceOf(Date);

    // scheduled → meeting_created is PR-3; jump connected via the allowed path
    await mockRequestService.pushStatus(EXPERT, id, 'meeting_created');
    await mockRequestService.markConnected(EXPERT, id);
    expect((await modelMock.getById(id)).status).toBe('connected');

    await mockRequestService.submitFeedback(EXPERT, id, { overall: 4, verdict: 'ready', strengths: 'modeling' });
    const done = await modelMock.getById(id);
    expect(done.status).toBe('completed');
    expect(done.feedback).toMatchObject({ overall: 4, verdict: 'ready' });
    expect(done.feedback.checklistCoverage.length).toBe(done.checklist.length);
  });

  it('rejects illegal transitions', async () => {
    const m = await makeMock();
    const id = m._id.toString();
    // can't schedule straight from requested
    await expect(mockRequestService.schedule(EXPERT, id, { scheduledAt: '2026-06-13T21:00:00Z' }))
      .rejects.toThrow(/cannot schedule from requested/);
    // can't complete from requested
    await expect(mockRequestService.submitFeedback(EXPERT, id, { overall: 3, verdict: 'ready' }))
      .rejects.toThrow(/cannot move from requested to completed/);
  });

  it('blocker: expert raises, recruiter resolves back to scheduling', async () => {
    const m = await makeMock();
    const id = m._id.toString();
    await mockRequestService.start(EXPERT, id);
    await mockRequestService.logCallAttempt(EXPERT, id, { outcome: 'no_answer' });
    await mockRequestService.raiseBlocker(EXPERT, id, { note: '2 attempts, no answer' });
    expect((await modelMock.getById(id)).status).toBe('recruiter_blocker');

    await mockRequestService.resolveBlocker(RECRUITER, id, { resolution: 'reached on WhatsApp' });
    const resolved = await modelMock.getById(id);
    expect(resolved.status).toBe('scheduling');
    expect(resolved.blocker.resolvedBy).toBe('aditya.singh@vizvainc.com');
  });

  it('reschedule preserves prior slot in scheduleHistory', async () => {
    const m = await makeMock();
    const id = m._id.toString();
    await mockRequestService.start(EXPERT, id);
    await mockRequestService.logCallAttempt(EXPERT, id, { outcome: 'reached', scheduledAt: '2026-06-13T21:00:00Z' });
    await mockRequestService.schedule(EXPERT, id, { scheduledAt: '2026-06-14T22:00:00Z', reason: 'family event' });
    const m2 = await modelMock.getById(id);
    expect(m2.scheduledAt.toISOString()).toBe('2026-06-14T22:00:00.000Z');
    expect(m2.scheduleHistory.length).toBe(1);
    expect(m2.scheduleHistory[0].reason).toBe('family event');
  });
});

describe('authority', () => {
  it('a stranger cannot start or view another team\'s mock', async () => {
    const m = await makeMock();
    const id = m._id.toString();
    await expect(mockRequestService.start(STRANGER, id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(mockRequestService.getDetail(STRANGER, id)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('feedback validates overall + verdict', async () => {
    const m = await makeMock();
    const id = m._id.toString();
    await mockRequestService.start(EXPERT, id);
    await mockRequestService.logCallAttempt(EXPERT, id, { outcome: 'reached', scheduledAt: '2026-06-13T21:00:00Z' });
    await mockRequestService.pushStatus(EXPERT, id, 'meeting_created');
    await mockRequestService.markConnected(EXPERT, id);
    await expect(mockRequestService.submitFeedback(EXPERT, id, { overall: 9, verdict: 'ready' }))
      .rejects.toThrow(/overall must be 1/);
    await expect(mockRequestService.submitFeedback(EXPERT, id, { overall: 4, verdict: 'bogus' }))
      .rejects.toThrow(/verdict must be/);
  });
});
