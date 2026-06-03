import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockToArray = jest.fn();
const mockSort = jest.fn(() => ({ limit: () => ({ toArray: mockToArray }) }));
const mockFind = jest.fn(() => ({ sort: mockSort }));
const mockCount = jest.fn();

// candidateController.js imports a heavy dependency graph (database + four
// services + userModel) at module load. The recruiter scope-filter path used
// by these tests touches none of them, so we stub them out to keep the import
// cheap — mirrors the taskController.ensureMeeting.test.js harness. We must
// preserve the real Candidate.js exports (spread `actual`) because the
// controller calls the real marketingInfoMissingFilter(); only candidateModel
// is replaced so collection.find/countDocuments are observable.
// Mock Candidate.js as a flat stub — same plain-object style as the sibling
// taskController.ensureMeeting.test.js harness. We deliberately do NOT spread
// the real module via `await import(...)` (re-enters this factory under Jest
// ESM → infinite recursion → OOM) nor `jest.requireActual` (sync/CJS-only,
// throws "Must use import to load ES Module" on native-ESM files). The
// controller only consumes candidateModel.collection and marketingInfoMissingFilter()
// from this module; the latter is stubbed to a benign $or filter so the
// controller's `{ $and: [...] }` composition is exercised and observable.
jest.unstable_mockModule('../src/models/Candidate.js', () => ({
  __esModule: true,
  candidateModel: { collection: { find: mockFind, countDocuments: mockCount } },
  marketingInfoMissingFilter: () => ({ $or: [{ visaType: { $in: [null, ''] } }] }),
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.unstable_mockModule('../src/config/database.js', () => ({ database: { getCollection: jest.fn() } }));
jest.unstable_mockModule('../src/models/User.js', () => ({ userModel: {} }));
jest.unstable_mockModule('../src/services/storageService.js', () => ({ storageService: {} }));
jest.unstable_mockModule('../src/services/resumeProfileService.js', () => ({ resumeProfileService: {} }));
jest.unstable_mockModule('../src/services/candidateService.js', () => ({ candidateService: {} }));
jest.unstable_mockModule('../src/services/candidateStatusService.js', () => ({ candidateStatusService: {} }));

const { candidateController } = await import('../src/controllers/candidateController.js');

function res() {
  const r = { statusCode: 200, body: undefined };
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((p) => { r.body = p; return r; });
  return r;
}
beforeEach(() => { jest.clearAllMocks(); mockCount.mockResolvedValue(2); mockToArray.mockResolvedValue([
  { _id: { toString: () => 'a1' }, 'Candidate Name': 'Aaa', Recruiter: 'rec@x.com', visaType: '', company: '', updated_at: 1 },
]); });

describe('candidateController.getMarketingInfoWorklist', () => {
  it('403 for a non-marketing role', async () => {
    const r = res();
    await candidateController.getMarketingInfoWorklist({ user: { email: 'e@x.com', role: 'expert' }, query: {} }, r);
    expect(r.statusCode).toBe(403);
  });

  it('401 when unauthenticated', async () => {
    const r = res();
    await candidateController.getMarketingInfoWorklist({ query: {} }, r);
    expect(r.statusCode).toBe(401);
  });

  it('recruiter: returns count + candidates', async () => {
    const r = res();
    await candidateController.getMarketingInfoWorklist({ user: { email: 'rec@x.com', role: 'recruiter' }, query: {} }, r);
    expect(r.body.success).toBe(true);
    expect(r.body.count).toBe(2);
    expect(r.body.candidates[0]).toMatchObject({ id: 'a1', name: 'Aaa' });
    const calledQuery = mockFind.mock.calls[0][0];
    expect(Array.isArray(calledQuery.$and)).toBe(true);
  });

  it('countOnly=1 short-circuits the find', async () => {
    const r = res();
    await candidateController.getMarketingInfoWorklist({ user: { email: 'rec@x.com', role: 'recruiter' }, query: { countOnly: '1' } }, r);
    expect(r.body).toEqual({ success: true, count: 2 });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it('500 on a database error', async () => {
    mockCount.mockRejectedValueOnce(new Error('DB timeout'));
    const r = res();
    await candidateController.getMarketingInfoWorklist({ user: { email: 'rec@x.com', role: 'recruiter' }, query: {} }, r);
    expect(r.statusCode).toBe(500);
    expect(r.body).toEqual({ success: false, error: 'Internal server error' });
  });
});
