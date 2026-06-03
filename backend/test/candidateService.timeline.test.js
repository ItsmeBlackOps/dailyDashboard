import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Harness mirrors candidateController.getCandidateById.test.js: stub the heavy
// dependency graph the service imports at module load, then exercise the
// read-time timeline aggregator. The aggregator reads the FULL candidate doc
// (createdAt/createdBy/editHistory/statusHistory/assignmentEmails), the
// `candidateactivities` collection, and the related `taskBody` interviews.
//
// Note: candidateModel.getCandidateById applies DEFAULT_PROJECTION, which is a
// pure-inclusion projection that omits editHistory/assignmentEmails/createdAt —
// so the implementation reads the raw doc via candidateModel.collection.findOne
// (same as candidateController.getCandidateById). We mock BOTH the raw findOne
// and the mapped getCandidateById to the same doc so the test stays honest with
// whichever read path the service uses.
const mockFindOne = jest.fn();
const mockGetCandidateById = jest.fn();
const mockGetCollection = jest.fn();
const mockActivitiesToArray = jest.fn();
const mockTasksToArray = jest.fn();

jest.unstable_mockModule('../src/models/Candidate.js', () => ({
  __esModule: true,
  candidateModel: {
    collection: { findOne: mockFindOne },
    getCandidateById: mockGetCandidateById,
  },
  // Constants the service imports at module load.
  WORKFLOW_STATUS: { awaitingExpert: 'awaiting_expert', needsResumeUnderstanding: 'needs_resume_understanding', completed: 'completed' },
  RESUME_UNDERSTANDING_STATUS: { pending: 'pending', done: 'done' },
  STATUS_VALUES: [],
  STATUS_ALIASES: {},
  TECHNOLOGY_VALUES: [],
  VISA_TYPE_VALUES: [],
  EAD_REQUIRED_VISA_TYPES: [],
  COMPANY_VALUES: [],
  ACK_EMAIL_VALUES: [],
  CANDIDATE_AUDITED: ['expert', 'teamLead', 'recruiter', 'branch', 'status'],
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.unstable_mockModule('../src/config/database.js', () => ({ database: { getCollection: mockGetCollection } }));
jest.unstable_mockModule('../src/models/User.js', () => ({ userModel: { getAllUsers: jest.fn(() => []), getUserByEmail: jest.fn(() => null) } }));
jest.unstable_mockModule('../src/services/userService.js', () => ({
  userService: { collectManageableUsers: jest.fn(() => []) },
  roleLevel: (r) => r,
}));

const { candidateService } = await import('../src/services/candidateService.js');

const VALID_ID = 'a'.repeat(24);
const USER = { email: 'mm@x.com', role: 'admin' };

function candidateDoc() {
  return {
    _id: { toString: () => VALID_ID },
    'Candidate Name': 'Asha',
    'Email ID': 'a@x.com',
    createdAt: '2026-05-31T09:00:00Z',
    createdBy: 'mm@x.com',
    editHistory: [
      { field: 'expert', oldValue: '', newValue: 'e@x.com', actor: 'mm@x.com', ts: '2026-06-01T10:00:00Z' },
      { field: 'status', oldValue: 'New', newValue: 'Active', actor: 'mm@x.com', ts: '2026-06-01T11:00:00Z' },
    ],
    statusHistory: [
      { from: 'New', to: 'Active', changedAt: '2026-06-01T11:00:00Z', changedBy: 'mm@x.com' },
    ],
    assignmentEmails: [
      { ts: '2026-06-02T09:00:00Z', to: ['rec@x.com'], cc: ['tl@x.com'], subject: 'Assignment: Asha', sender: 'mm@x.com' },
    ],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  const doc = candidateDoc();
  mockFindOne.mockResolvedValue(doc);
  mockGetCandidateById.mockResolvedValue(doc);

  // database.getCollection('candidateactivities') → find().sort().toArray()
  // database.getCollection('taskBody')           → find().sort().limit().toArray()
  mockGetCollection.mockImplementation((name) => {
    if (name === 'candidateactivities') {
      return { find: () => ({ sort: () => ({ toArray: mockActivitiesToArray }) }) };
    }
    if (name === 'taskBody') {
      return { find: () => ({ sort: () => ({ limit: () => ({ toArray: mockTasksToArray }) }) }) };
    }
    return { find: () => ({ sort: () => ({ toArray: async () => [] }) }) };
  });
  mockActivitiesToArray.mockResolvedValue([
    { _id: 'act1', type: 'call_attempt', outcome: 'connected', createdBy: { email: 'e@x.com' }, createdAt: '2026-06-03T08:00:00Z' },
  ]);
  mockTasksToArray.mockResolvedValue([]);
});

describe('candidateService.getCandidateTimeline', () => {
  it('merges all sources into one feed sorted newest-first', async () => {
    const timeline = await candidateService.getCandidateTimeline(USER, VALID_ID);
    expect(Array.isArray(timeline)).toBe(true);
    // Strictly descending by ts.
    const times = timeline.map((e) => new Date(e.ts).getTime());
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
    // Newest event is the call_attempt (2026-06-03), oldest is the created (2026-05-31).
    expect(timeline[0].type).toBe('call_attempt');
    expect(timeline[timeline.length - 1].type).toBe('created');
  });

  it('emits exactly ONE status event, sourced from statusHistory (no editHistory dupe)', async () => {
    const timeline = await candidateService.getCandidateTimeline(USER, VALID_ID);
    const statusEvents = timeline.filter((e) => e.type === 'status_changed');
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0].label).toBe('Status: New → Active');
    expect(statusEvents[0].source).toBe('statusHistory');
    // editHistory status entries are skipped — none of the field_changed events
    // is a status change.
    const fieldStatus = timeline.filter((e) => e.type === 'field_changed' && /status/i.test(e.label));
    expect(fieldStatus).toHaveLength(0);
  });

  it('emits an expert field_changed event labelled "Expert assigned"', async () => {
    const timeline = await candidateService.getCandidateTimeline(USER, VALID_ID);
    const expertEvent = timeline.find((e) => e.type === 'field_changed' && /expert/i.test(e.label));
    expect(expertEvent).toBeDefined();
    expect(expertEvent.label).toBe('Expert assigned');
    expect(expertEvent.source).toBe('editHistory');
  });

  it('emits an assignment_email event', async () => {
    const timeline = await candidateService.getCandidateTimeline(USER, VALID_ID);
    const emailEvent = timeline.find((e) => e.type === 'assignment_email');
    expect(emailEvent).toBeDefined();
    expect(emailEvent.label).toContain('Assignment email sent to rec@x.com');
  });

  it('passes through the call_attempt activity', async () => {
    const timeline = await candidateService.getCandidateTimeline(USER, VALID_ID);
    const call = timeline.find((e) => e.type === 'call_attempt');
    expect(call).toBeDefined();
    expect(call.source).toBe('activity');
  });

  it('emits a created event', async () => {
    const timeline = await candidateService.getCandidateTimeline(USER, VALID_ID);
    const created = timeline.find((e) => e.type === 'created');
    expect(created).toBeDefined();
    expect(created.label).toBe('Candidate created');
  });

  it('normalises each event to { id, ts(Date), type, label, actor, detail, source }', async () => {
    const timeline = await candidateService.getCandidateTimeline(USER, VALID_ID);
    for (const e of timeline) {
      expect(typeof e.id).toBe('string');
      expect(e.ts instanceof Date).toBe(true);
      expect(typeof e.type).toBe('string');
      expect(typeof e.label).toBe('string');
      expect('actor' in e).toBe(true);
      expect('detail' in e).toBe(true);
      expect(typeof e.source).toBe('string');
    }
  });

  it('is defensive: empty sources yield a created-only feed', async () => {
    mockFindOne.mockResolvedValueOnce({ _id: { toString: () => VALID_ID }, 'Email ID': 'a@x.com', createdAt: '2026-05-31T09:00:00Z', createdBy: 'mm@x.com' });
    mockGetCandidateById.mockResolvedValueOnce({ _id: { toString: () => VALID_ID }, 'Email ID': 'a@x.com', createdAt: '2026-05-31T09:00:00Z', createdBy: 'mm@x.com' });
    mockActivitiesToArray.mockResolvedValueOnce([]);
    mockTasksToArray.mockResolvedValueOnce([]);
    const timeline = await candidateService.getCandidateTimeline(USER, VALID_ID);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].type).toBe('created');
  });

  it('401 when unauthenticated', async () => {
    await expect(candidateService.getCandidateTimeline(null, VALID_ID)).rejects.toMatchObject({ statusCode: 401 });
    await expect(candidateService.getCandidateTimeline({ email: 'x@x.com' }, VALID_ID)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('400 when no candidateId', async () => {
    await expect(candidateService.getCandidateTimeline(USER, '')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('404 when the candidate does not exist', async () => {
    mockFindOne.mockResolvedValueOnce(null);
    mockGetCandidateById.mockResolvedValueOnce(null);
    await expect(candidateService.getCandidateTimeline(USER, VALID_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});
