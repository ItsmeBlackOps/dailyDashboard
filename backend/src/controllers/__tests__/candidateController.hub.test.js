import { jest } from '@jest/globals';

// ── Shared mock state ─────────────────────────────────────────────────────────
const mockHubConfigFindOne  = jest.fn();
const mockHubConfigFind     = jest.fn();
const mockHubConfigUpdateOne = jest.fn();
const mockCandidateFind     = jest.fn();
const mockCandidateAggregate = jest.fn();

const hubConfigCol = {
  find:      mockHubConfigFind,
  findOne:   mockHubConfigFindOne,
  updateOne: mockHubConfigUpdateOne,
};

const candidateCol = {
  find:      mockCandidateFind,
  aggregate: mockCandidateAggregate,
};

jest.unstable_mockModule('../../config/database.js', () => ({
  database: {
    getCollection: jest.fn(name => {
      if (name === 'hubConfig') return hubConfigCol;
      return null;
    }),
    getDatabase: jest.fn(() => ({ collection: jest.fn() })),
  },
}));

jest.unstable_mockModule('../../models/Candidate.js', () => ({
  candidateModel: {
    collection: candidateCol,
  },
}));

jest.unstable_mockModule('../../models/User.js', () => ({
  userModel: {
    formatDisplayNameFromEmail: jest.fn(e => e),
    getTeamEmails: jest.fn(() => []),
    getUserProfileMetadata: jest.fn(),
  },
}));

jest.unstable_mockModule('../../services/storageService.js', () => ({
  storageService: {},
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { candidateController } = await import('../candidateController.js');

function createRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = jest.fn(code => { res.statusCode = code; return res; });
  res.json   = jest.fn(payload => { res.body = payload; return res; });
  return res;
}

const ADMIN_USER  = { email: 'admin@vizvainc.com', role: 'admin' };
const RECRUITER_USER = { email: 'r@vizvainc.com', role: 'recruiter' };

// ── getHubConfig ──────────────────────────────────────────────────────────────
describe('candidateController.getHubConfig', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns defaults when no docs exist', async () => {
    mockHubConfigFind.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

    const req = { user: ADMIN_USER };
    const res = createRes();
    await candidateController.getHubConfig(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.agingThresholds).toEqual({ fresh: 2, warm: 5, aging: 10 });
    expect(res.body.workloadConfig).toEqual({ defaultCapacity: 20, capacities: {} });
  });

  it('returns saved values when docs exist', async () => {
    const savedDocs = [
      { key: 'agingThresholds', value: { fresh: 3, warm: 7, aging: 14 } },
      { key: 'workloadConfig', value: { defaultCapacity: 15, capacities: { 'r@vizvainc.com': 10 } } },
    ];
    mockHubConfigFind.mockReturnValue({ toArray: jest.fn().mockResolvedValue(savedDocs) });

    const req = { user: ADMIN_USER };
    const res = createRes();
    await candidateController.getHubConfig(req, res);

    expect(res.body.agingThresholds).toEqual({ fresh: 3, warm: 7, aging: 14 });
    expect(res.body.workloadConfig).toEqual({ defaultCapacity: 15, capacities: { 'r@vizvainc.com': 10 } });
  });
});

// ── updateHubConfig ───────────────────────────────────────────────────────────
describe('candidateController.updateHubConfig', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 403 if user is not admin', async () => {
    const req = { user: RECRUITER_USER, body: { key: 'agingThresholds', value: { fresh: 1, warm: 3, aging: 7 } } };
    const res = createRes();
    await candidateController.updateHubConfig(req, res);
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 for invalid key', async () => {
    const req = { user: ADMIN_USER, body: { key: 'invalidKey', value: {} } };
    const res = createRes();
    await candidateController.updateHubConfig(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('upserts the doc with updatedBy and updatedAt', async () => {
    mockHubConfigUpdateOne.mockResolvedValue({ acknowledged: true });
    const value = { fresh: 3, warm: 7, aging: 14 };
    const req = { user: ADMIN_USER, body: { key: 'agingThresholds', value } };
    const res = createRes();

    await candidateController.updateHubConfig(req, res);

    expect(mockHubConfigUpdateOne).toHaveBeenCalledWith(
      { key: 'agingThresholds' },
      { $set: expect.objectContaining({
        key: 'agingThresholds',
        value,
        updatedBy: 'admin@vizvainc.com',
        updatedAt: expect.any(Date),
      }) },
      { upsert: true }
    );
    expect(res.body.success).toBe(true);
    expect(res.body.key).toBe('agingThresholds');
  });
});

// ── getHubAging ───────────────────────────────────────────────────────────────
describe('candidateController.getHubAging', () => {
  beforeEach(() => jest.clearAllMocks());

  const NOW = Date.now();

  function daysAgo(n) {
    return new Date(NOW - n * 86400000);
  }

  it('computes idleDays and assigns buckets correctly', async () => {
    mockHubConfigFindOne.mockResolvedValue({ key: 'agingThresholds', value: { fresh: 2, warm: 5, aging: 10 } });

    const docs = [
      { _id: '1', 'Candidate Name': 'Alice', Recruiter: 'r@vizvainc.com', Branch: 'GGR', status: 'Active', updated_at: daysAgo(1) },
      { _id: '2', 'Candidate Name': 'Bob',   Recruiter: 'r@vizvainc.com', Branch: 'GGR', status: 'Active', updated_at: daysAgo(4) },
      { _id: '3', 'Candidate Name': 'Carol', Recruiter: 'r@vizvainc.com', Branch: 'GGR', status: 'Active', updated_at: daysAgo(8) },
      { _id: '4', 'Candidate Name': 'Dave',  Recruiter: 'r@vizvainc.com', Branch: 'GGR', status: 'Active', updated_at: daysAgo(15) },
    ];
    mockCandidateFind.mockReturnValue({ toArray: jest.fn().mockResolvedValue(docs) });

    const req = { user: RECRUITER_USER, query: {} };
    const res = createRes();
    await candidateController.getHubAging(req, res);

    const candidates = res.body.candidates;
    expect(candidates.find(c => c.name === 'Alice').agingStatus).toBe('fresh');
    expect(candidates.find(c => c.name === 'Bob').agingStatus).toBe('warm');
    expect(candidates.find(c => c.name === 'Carol').agingStatus).toBe('aging');
    expect(candidates.find(c => c.name === 'Dave').agingStatus).toBe('critical');
  });

  it('excludes candidates with status Backout or Placement Offer', async () => {
    mockHubConfigFindOne.mockResolvedValue(null);

    const docs = [
      { _id: '1', 'Candidate Name': 'Active One', Recruiter: 'r@vizvainc.com', status: 'Active', updated_at: daysAgo(3) },
    ];
    mockCandidateFind.mockReturnValue({ toArray: jest.fn().mockResolvedValue(docs) });

    const req = { user: RECRUITER_USER, query: {} };
    const res = createRes();
    await candidateController.getHubAging(req, res);

    // verify the filter passed to find excludes those statuses
    const filterArg = mockCandidateFind.mock.calls[0][0];
    expect(filterArg.status.$nin).toContain('Backout');
    expect(filterArg.status.$nin).toContain('Placement Offer');
  });

  it('sorts candidates by idleDays DESC', async () => {
    mockHubConfigFindOne.mockResolvedValue(null);

    const docs = [
      { _id: '1', 'Candidate Name': 'Alice', Recruiter: 'r@vizvainc.com', status: 'Active', updated_at: daysAgo(2) },
      { _id: '2', 'Candidate Name': 'Bob',   Recruiter: 'r@vizvainc.com', status: 'Active', updated_at: daysAgo(20) },
      { _id: '3', 'Candidate Name': 'Carol', Recruiter: 'r@vizvainc.com', status: 'Active', updated_at: daysAgo(5) },
    ];
    mockCandidateFind.mockReturnValue({ toArray: jest.fn().mockResolvedValue(docs) });

    const req = { user: RECRUITER_USER, query: {} };
    const res = createRes();
    await candidateController.getHubAging(req, res);

    const names = res.body.candidates.map(c => c.name);
    expect(names[0]).toBe('Bob');
    expect(names[names.length - 1]).toBe('Alice');
  });

  it('returns the thresholds actually used', async () => {
    const customThresholds = { fresh: 1, warm: 3, aging: 7 };
    mockHubConfigFindOne.mockResolvedValue({ key: 'agingThresholds', value: customThresholds });
    mockCandidateFind.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

    const req = { user: RECRUITER_USER, query: {} };
    const res = createRes();
    await candidateController.getHubAging(req, res);

    expect(res.body.thresholds).toEqual(customThresholds);
  });
});

// ── getHubWorkload ────────────────────────────────────────────────────────────
describe('candidateController.getHubWorkload', () => {
  beforeEach(() => jest.clearAllMocks());

  function setupWorkload({ activeAgg, totalAgg, workloadConfig } = {}) {
    mockHubConfigFindOne.mockResolvedValue(
      workloadConfig ? { key: 'workloadConfig', value: workloadConfig } : null
    );

    let callCount = 0;
    mockCandidateAggregate.mockImplementation(() => {
      callCount++;
      const result = callCount === 1
        ? (activeAgg || [])
        : (totalAgg || []);
      return { toArray: jest.fn().mockResolvedValue(result) };
    });
  }

  it('computes workloadRatio and status correctly', async () => {
    setupWorkload({
      activeAgg: [{ _id: 'r@vizvainc.com', activeCount: 18 }],
      totalAgg:  [{ _id: 'r@vizvainc.com', totalCount: 25 }],
      workloadConfig: { defaultCapacity: 20, capacities: {} },
    });

    const req = { user: ADMIN_USER, query: {} };
    const res = createRes();
    await candidateController.getHubWorkload(req, res);

    const recruiter = res.body.recruiters[0];
    expect(recruiter.workloadRatio).toBe(0.9);
    expect(recruiter.workloadStatus).toBe('optimal');
  });

  it('status > 0.9 = overloaded', async () => {
    setupWorkload({
      activeAgg: [{ _id: 'r@vizvainc.com', activeCount: 19 }],
      totalAgg:  [{ _id: 'r@vizvainc.com', totalCount: 19 }],
      workloadConfig: { defaultCapacity: 20, capacities: {} },
    });

    const req = { user: ADMIN_USER, query: {} };
    const res = createRes();
    await candidateController.getHubWorkload(req, res);

    const recruiter = res.body.recruiters[0];
    expect(recruiter.workloadRatio).toBeGreaterThan(0.9);
    expect(recruiter.workloadStatus).toBe('overloaded');
  });

  it('status < 0.4 = underutilized', async () => {
    setupWorkload({
      activeAgg: [{ _id: 'r@vizvainc.com', activeCount: 3 }],
      totalAgg:  [{ _id: 'r@vizvainc.com', totalCount: 10 }],
      workloadConfig: { defaultCapacity: 20, capacities: {} },
    });

    const req = { user: ADMIN_USER, query: {} };
    const res = createRes();
    await candidateController.getHubWorkload(req, res);

    const recruiter = res.body.recruiters[0];
    expect(recruiter.workloadStatus).toBe('underutilized');
  });

  it('uses defaultCapacity when recruiter has no override', async () => {
    setupWorkload({
      activeAgg: [{ _id: 'r@vizvainc.com', activeCount: 10 }],
      totalAgg:  [{ _id: 'r@vizvainc.com', totalCount: 10 }],
      workloadConfig: { defaultCapacity: 25, capacities: {} },
    });

    const req = { user: ADMIN_USER, query: {} };
    const res = createRes();
    await candidateController.getHubWorkload(req, res);

    const recruiter = res.body.recruiters[0];
    expect(recruiter.capacity).toBe(25);
  });

  it('filters to vizvainc.com domain only', async () => {
    setupWorkload({
      activeAgg: [
        { _id: 'r@vizvainc.com',      activeCount: 5 },
        { _id: 'r@silverspaceinc.com', activeCount: 5 },
      ],
      totalAgg: [
        { _id: 'r@vizvainc.com',      totalCount: 10 },
        { _id: 'r@silverspaceinc.com', totalCount: 10 },
      ],
      workloadConfig: { defaultCapacity: 20, capacities: {} },
    });

    const req = { user: ADMIN_USER, query: {} };
    const res = createRes();
    await candidateController.getHubWorkload(req, res);

    const emails = res.body.recruiters.map(r => r.email);
    expect(emails).toContain('r@vizvainc.com');
    expect(emails.every(e => e.endsWith('@vizvainc.com'))).toBe(true);
  });

  it('sorts recruiters by workloadRatio DESC', async () => {
    setupWorkload({
      activeAgg: [
        { _id: 'high@vizvainc.com', activeCount: 18 },
        { _id: 'low@vizvainc.com',  activeCount: 2 },
      ],
      totalAgg: [
        { _id: 'high@vizvainc.com', totalCount: 20 },
        { _id: 'low@vizvainc.com',  totalCount: 5 },
      ],
      workloadConfig: { defaultCapacity: 20, capacities: {} },
    });

    const req = { user: ADMIN_USER, query: {} };
    const res = createRes();
    await candidateController.getHubWorkload(req, res);

    const ratios = res.body.recruiters.map(r => r.workloadRatio);
    expect(ratios[0]).toBeGreaterThan(ratios[ratios.length - 1]);
  });
});
