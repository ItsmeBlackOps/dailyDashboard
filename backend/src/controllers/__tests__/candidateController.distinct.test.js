import { jest } from '@jest/globals';

// ── Shared mock state ─────────────────────────────────────────────────────────
const mockDistinct = jest.fn();

const candidateDetailsCol = {
  distinct: mockDistinct,
};

jest.unstable_mockModule('../../config/database.js', () => ({
  database: {
    getCollection: jest.fn(name => {
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

const ADMIN_USER     = { email: 'admin@vizvainc.com', role: 'admin' };
const RECRUITER_USER = { email: 'r@vizvainc.com',    role: 'recruiter' };

// ── getDistinctClients ────────────────────────────────────────────────────────
describe('candidateController.getDistinctClients', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls distinct with a filter that excludes null/empty End Client values', async () => {
    mockDistinct.mockResolvedValue(['Acme']);

    const req = { user: ADMIN_USER };
    const res = createRes();
    await candidateController.getDistinctClients(req, res);

    expect(mockDistinct).toHaveBeenCalledTimes(1);
    const [field, filter] = mockDistinct.mock.calls[0];
    expect(field).toBe('End Client');
    expect(filter['End Client']).toMatchObject({ $exists: true });
    expect(filter['End Client'].$nin).toEqual(expect.arrayContaining([null, '', undefined]));
  });

  it('returns clients sorted case-insensitively', async () => {
    mockDistinct.mockResolvedValue(['microsoft', 'Acme', 'Z-Corp']);

    const req = { user: ADMIN_USER };
    const res = createRes();
    await candidateController.getDistinctClients(req, res);

    expect(res.body.success).toBe(true);
    expect(res.body.clients).toEqual(['Acme', 'microsoft', 'Z-Corp']);
  });

  it('filters out empty strings and whitespace-only entries from distinct results', async () => {
    mockDistinct.mockResolvedValue(['Acme', '', '   ', 'Microsoft', null]);

    const req = { user: ADMIN_USER };
    const res = createRes();
    await candidateController.getDistinctClients(req, res);

    expect(res.body.clients).not.toContain('');
    expect(res.body.clients).not.toContain('   ');
    expect(res.body.clients).not.toContain(null);
    expect(res.body.clients).toEqual(expect.arrayContaining(['Acme', 'Microsoft']));
    expect(res.body.clients).toHaveLength(2);
  });

  it('returns 500 on database error', async () => {
    mockDistinct.mockRejectedValue(new Error('DB connection lost'));

    const req = { user: RECRUITER_USER };
    const res = createRes();
    await candidateController.getDistinctClients(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
  });

  it('sets Cache-Control: private, max-age=60 response header', async () => {
    mockDistinct.mockResolvedValue(['Acme']);

    const req = { user: ADMIN_USER };
    const res = createRes();
    await candidateController.getDistinctClients(req, res);

    expect(res.headers['Cache-Control']).toBe('private, max-age=60');
  });
});
