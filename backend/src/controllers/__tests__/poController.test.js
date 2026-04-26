import { jest } from '@jest/globals';

// ── Mock collection methods ───────────────────────────────────────────────────
const mockFindOne     = jest.fn();
const mockInsertOne   = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockDeleteOne   = jest.fn();

const fakeCollection = {
  findOne: mockFindOne,
  insertOne: mockInsertOne,
  findOneAndUpdate: mockFindOneAndUpdate,
  deleteOne: mockDeleteOne,
};

jest.unstable_mockModule('../../config/database.js', () => ({
  database: {
    // poController calls database.getDb() — we provide it here
    getDb: jest.fn(() => ({ collection: jest.fn(() => fakeCollection) })),
    getDatabase: jest.fn(() => ({ collection: jest.fn(() => fakeCollection) })),
  },
}));

const mockCreateDraft = jest.fn();
jest.unstable_mockModule('../../services/graphMailService.js', () => ({
  graphMailService: { createDraft: mockCreateDraft },
  AzureMailNotConfiguredError: class AzureMailNotConfiguredError extends Error {},
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { poController } = await import('../poController.js');

function createRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = jest.fn(code => { res.statusCode = code; return res; });
  res.json   = jest.fn(payload => { res.body = payload; return res; });
  return res;
}

const ADMIN_USER = { email: 'admin@vizvainc.com', role: 'admin' };
const RECRUITER_USER = { email: 'r@vizvainc.com', role: 'recruiter' };

// ── createOrUpdate ────────────────────────────────────────────────────────────
describe('poController.createOrUpdate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 when candidateName is missing', async () => {
    const req = { user: ADMIN_USER, body: { emailId: 'test@test.com' } };
    const res = createRes();
    await poController.createOrUpdate(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/candidateName/i);
  });

  it('returns 400 (not 500) for invalid candidateId', async () => {
    const req = {
      user: ADMIN_USER,
      body: { candidateName: 'Test Candidate', candidateId: 'not-a-valid-object-id' },
    };
    const res = createRes();
    await poController.createOrUpdate(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('safeNum does not admit NaN — falls back to the explicit fallback', async () => {
    mockInsertOne.mockResolvedValue({ insertedId: 'new-id' });
    const req = {
      user: ADMIN_USER,
      body: {
        candidateName: 'Test Candidate',
        // agreementPct is non-null so safeNum runs with fallback=null; NaN → null
        agreementPct: 'not-a-number',
        // poCount.total is undefined → safeNum(undefined, 0) → 0
        poCount: { total: 'NaN' },
      },
    };
    const res = createRes();
    await poController.createOrUpdate(req, res);

    // Should not return 500 — safeNum returns its fallback for NaN inputs
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    // safeNum('not-a-number', null) → NaN is not finite → returns null
    expect(res.body.po.agreementPct).toBeNull();
    // safeNum('NaN', 0) → NaN is not finite → returns 0 (default fallback)
    expect(res.body.po.poCount.total).toBe(0);
  });

  it('creates a new PO when no _id provided', async () => {
    mockInsertOne.mockResolvedValue({ insertedId: 'abc123' });
    const req = {
      user: ADMIN_USER,
      body: {
        candidateName: 'John Doe',
        emailId: 'john@test.com',
        poCount: { total: 3 },
      },
    };
    const res = createRes();
    await poController.createOrUpdate(req, res);

    expect(mockInsertOne).toHaveBeenCalledTimes(1);
    expect(res.body.success).toBe(true);
    expect(res.body.po.candidateName).toBe('John Doe');
  });
});

// ── remove ────────────────────────────────────────────────────────────────────
describe('poController.remove', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 403 for unauthorized role', async () => {
    const req = { user: RECRUITER_USER, params: { id: '507f1f77bcf86cd799439011' } };
    const res = createRes();
    await poController.remove(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('allows admin to delete', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 1 });
    const req = { user: ADMIN_USER, params: { id: '507f1f77bcf86cd799439011' } };
    const res = createRes();
    await poController.remove(req, res);
    expect(mockDeleteOne).toHaveBeenCalledTimes(1);
    expect(res.body.success).toBe(true);
  });

  it('allows mam role to delete', async () => {
    mockDeleteOne.mockResolvedValue({ deletedCount: 1 });
    const req = {
      user: { email: 'mam@vizvainc.com', role: 'mam' },
      params: { id: '507f1f77bcf86cd799439011' },
    };
    const res = createRes();
    await poController.remove(req, res);
    expect(res.body.success).toBe(true);
  });
});

// ── createDraftEmail ──────────────────────────────────────────────────────────
describe('poController.createDraftEmail', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when no Bearer token in Authorization header', async () => {
    const poId = '507f1f77bcf86cd799439011';
    mockFindOne.mockResolvedValue({ _id: poId, candidateName: 'Jane Doe' });

    const req = {
      user: ADMIN_USER,
      headers: {},
      params: { id: poId },
    };
    const res = createRes();
    await poController.createDraftEmail(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 404 when PO not found', async () => {
    mockFindOne.mockResolvedValue(null);

    const req = {
      user: ADMIN_USER,
      headers: { authorization: 'Bearer some-token' },
      params: { id: '507f1f77bcf86cd799439011' },
    };
    const res = createRes();
    await poController.createDraftEmail(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('creates draft and returns messageId + webLink', async () => {
    const poId = '507f1f77bcf86cd799439011';
    mockFindOne.mockResolvedValue({ _id: poId, candidateName: 'Jane Doe' });
    mockCreateDraft.mockResolvedValue({ id: 'msg-999', webLink: 'https://outlook.live.com/msg/msg-999' });

    const req = {
      user: ADMIN_USER,
      headers: { authorization: 'Bearer user-token-abc' },
      params: { id: poId },
    };
    const res = createRes();
    await poController.createDraftEmail(req, res);

    expect(mockCreateDraft).toHaveBeenCalledWith('user-token-abc', expect.objectContaining({
      subject: expect.stringContaining('Jane Doe'),
    }));
    expect(res.body.success).toBe(true);
    expect(res.body.messageId).toBe('msg-999');
  });
});

// ── getByCandidateId ──────────────────────────────────────────────────────────
describe('poController.getByCandidateId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 for invalid ObjectId', async () => {
    const req = { params: { candidateId: 'not-valid' } };
    const res = createRes();
    await poController.getByCandidateId(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns PO when found', async () => {
    const po = { _id: '507f1f77bcf86cd799439011', candidateName: 'Alice' };
    mockFindOne.mockResolvedValue(po);

    const req = { params: { candidateId: '507f1f77bcf86cd799439011' } };
    const res = createRes();
    await poController.getByCandidateId(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.po).toMatchObject({ candidateName: 'Alice' });
  });

  it('returns null po when not found', async () => {
    mockFindOne.mockResolvedValue(null);
    const req = { params: { candidateId: '507f1f77bcf86cd799439011' } };
    const res = createRes();
    await poController.getByCandidateId(req, res);
    expect(res.body.success).toBe(true);
    expect(res.body.po).toBeNull();
  });
});
