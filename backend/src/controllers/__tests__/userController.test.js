import { jest } from '@jest/globals';

// We test the getActiveUsers method and the nameFromEmail helper (via its outputs)

const mockToArray = jest.fn();
const mockProject = jest.fn(() => ({ toArray: mockToArray }));
const mockFind = jest.fn(() => ({ project: mockProject }));
const mockCollection = jest.fn(() => ({ find: mockFind }));
const mockGetDatabase = jest.fn(() => ({ collection: mockCollection }));

jest.unstable_mockModule('../../config/database.js', () => ({
  database: { getDatabase: mockGetDatabase },
}));

jest.unstable_mockModule('../../services/userService.js', () => ({
  userService: {},
}));

jest.unstable_mockModule('../../middleware/errorHandler.js', () => ({
  asyncHandler: fn => fn,
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { UserController } = await import('../userController.js');

function createRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = jest.fn(code => { res.statusCode = code; return res; });
  res.json  = jest.fn(payload => { res.body = payload; return res; });
  return res;
}

describe('UserController.getActiveUsers', () => {
  let controller;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new UserController();
  });

  it('filters by active: true and returns users + byRole map', async () => {
    const docs = [
      { email: 'john.doe@vizvainc.com', role: 'recruiter', displayName: null, name: null },
      { email: 'jane.smith@vizvainc.com', role: 'mlead', displayName: 'Jane Smith', name: null },
    ];
    mockToArray.mockResolvedValue(docs);

    const req = { query: {}, user: {} };
    const res = createRes();

    await controller.getActiveUsers(req, res);

    expect(mockFind).toHaveBeenCalledWith({ active: true });
    expect(res.body.success).toBe(true);
    expect(res.body.users).toHaveLength(2);
  });

  it('derives names from email when displayName and name are absent', async () => {
    const docs = [
      { email: 'john.doe@vizvainc.com',  role: 'recruiter' },
      { email: 'j_smith@silverspaceinc.com', role: 'recruiter' },
      { email: 'single@x.com', role: 'user' },
    ];
    mockToArray.mockResolvedValue(docs);

    const req = { query: {}, user: {} };
    const res = createRes();

    await controller.getActiveUsers(req, res);

    const users = res.body.users;
    expect(users.find(u => u.email === 'john.doe@vizvainc.com').name).toBe('John Doe');
    expect(users.find(u => u.email === 'j_smith@silverspaceinc.com').name).toBe('J Smith');
    expect(users.find(u => u.email === 'single@x.com').name).toBe('Single');
  });

  it('returns byRole map correctly grouped', async () => {
    const docs = [
      { email: 'a@vizvainc.com', role: 'recruiter' },
      { email: 'b@vizvainc.com', role: 'recruiter' },
      { email: 'c@vizvainc.com', role: 'admin' },
    ];
    mockToArray.mockResolvedValue(docs);

    const req = { query: {}, user: {} };
    const res = createRes();

    await controller.getActiveUsers(req, res);

    const { byRole } = res.body;
    expect(byRole.recruiter).toHaveLength(2);
    expect(byRole.admin).toHaveLength(1);
  });

  it('applies ?role= filter when provided', async () => {
    mockToArray.mockResolvedValue([
      { email: 'r@vizvainc.com', role: 'recruiter' },
    ]);

    const req = { query: { role: 'recruiter,mlead' }, user: {} };
    const res = createRes();

    await controller.getActiveUsers(req, res);

    expect(mockFind).toHaveBeenCalledWith({
      active: true,
      role: { $in: ['recruiter', 'mlead'] },
    });
    expect(res.body.success).toBe(true);
  });

  it('returns 500 on database error', async () => {
    mockGetDatabase.mockImplementationOnce(() => { throw new Error('DB down'); });

    const req = { query: {}, user: {} };
    const res = createRes();

    await controller.getActiveUsers(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
