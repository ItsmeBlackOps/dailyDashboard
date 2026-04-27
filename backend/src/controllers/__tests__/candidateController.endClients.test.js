import { jest } from '@jest/globals';

// ── Shared mock state ─────────────────────────────────────────────────────────
const mockInsertOne = jest.fn();
const mockFindOne   = jest.fn();
const mockCandidateDistinct = jest.fn();

const endClientsCol = {
  insertOne: mockInsertOne,
  findOne:   mockFindOne,
};

const candidateDetailsCol = {
  distinct: mockCandidateDistinct,
};

jest.unstable_mockModule('../../config/database.js', () => ({
  database: {
    getCollection: jest.fn(name => {
      if (name === 'endClients')       return endClientsCol;
      if (name === 'candidateDetails') return candidateDetailsCol;
      return null;
    }),
    getDatabase: jest.fn(() => ({ collection: jest.fn() })),
  },
}));

jest.unstable_mockModule('../../models/Candidate.js', () => ({
  candidateModel: {
    collection: { find: jest.fn(), aggregate: jest.fn() },
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
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = jest.fn(code => { res.statusCode = code; return res; });
  res.json   = jest.fn(payload => { res.body = payload; return res; });
  res.set    = jest.fn((key, value) => { res.headers[key] = value; return res; });
  return res;
}

const ADMIN_USER = { email: 'admin@vizvainc.com', role: 'admin' };

// ── addEndClient ─────────────────────────────────────────────────────────────
describe('candidateController.addEndClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no duplicates
    mockFindOne.mockResolvedValue(null);
    mockCandidateDistinct.mockResolvedValue([]);
    mockInsertOne.mockResolvedValue({ insertedId: 'mock-id' });
  });

  it('returns 400 for empty name', async () => {
    const req = { user: ADMIN_USER, body: { name: '' } };
    const res = createRes();
    await candidateController.addEndClient(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for whitespace-only name', async () => {
    const req = { user: ADMIN_USER, body: { name: '   ' } };
    const res = createRes();
    await candidateController.addEndClient(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for name longer than 200 characters', async () => {
    const req = { user: ADMIN_USER, body: { name: 'A'.repeat(201) } };
    const res = createRes();
    await candidateController.addEndClient(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('title-cases the name: "acme corp" becomes "Acme Corp"', async () => {
    const req = { user: ADMIN_USER, body: { name: 'acme corp' } };
    const res = createRes();
    await candidateController.addEndClient(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.client).toBe('Acme Corp');

    const insertedDoc = mockInsertOne.mock.calls[0][0];
    expect(insertedDoc.name).toBe('Acme Corp');
    expect(insertedDoc.normalizedName).toBe('acme corp');
  });

  it('preserves all-caps tokens (≤ 4 chars) like "IBM"', async () => {
    const req = { user: ADMIN_USER, body: { name: 'IBM consulting' } };
    const res = createRes();
    await candidateController.addEndClient(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.client).toBe('IBM Consulting');
  });

  it('returns 409 with existing canonical name when duplicate found in endClients collection', async () => {
    mockFindOne.mockResolvedValue({ name: 'Acme Corp', normalizedName: 'acme corp' });

    const req = { user: ADMIN_USER, body: { name: 'ACME CORP' } };
    const res = createRes();
    await candidateController.addEndClient(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Company already exists');
    expect(res.body.existing).toBe('Acme Corp');
    expect(mockInsertOne).not.toHaveBeenCalled();
  });

  it('returns 409 when duplicate found in candidateDetails distinct values', async () => {
    mockFindOne.mockResolvedValue(null);
    mockCandidateDistinct.mockResolvedValue(['Globex Corporation', 'Initech']);

    const req = { user: ADMIN_USER, body: { name: 'globex corporation' } };
    const res = createRes();
    await candidateController.addEndClient(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Company already exists');
    expect(res.body.existing).toBe('Globex Corporation');
    expect(mockInsertOne).not.toHaveBeenCalled();
  });

  it('inserts with createdBy, createdAt, and normalizedName on success', async () => {
    const req = { user: ADMIN_USER, body: { name: 'new company' } };
    const res = createRes();
    await candidateController.addEndClient(req, res);

    expect(mockInsertOne).toHaveBeenCalledTimes(1);
    const doc = mockInsertOne.mock.calls[0][0];
    expect(doc.name).toBe('New Company');
    expect(doc.normalizedName).toBe('new company');
    expect(doc.createdBy).toBe('admin@vizvainc.com');
    expect(doc.createdAt).toBeInstanceOf(Date);
  });

  it('returns 201 with { success: true, client } on success', async () => {
    const req = { user: ADMIN_USER, body: { name: 'Stark Industries' } };
    const res = createRes();
    await candidateController.addEndClient(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.client).toBe('Stark Industries');
  });

  it('returns 500 on DB error during insertOne', async () => {
    mockInsertOne.mockRejectedValue(new Error('Mongo write failed'));

    const req = { user: ADMIN_USER, body: { name: 'Test Corp' } };
    const res = createRes();
    await candidateController.addEndClient(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
