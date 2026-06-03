import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// SP1 Task 6a — controller passthrough for the scoped marketing-info write.
// The controller is thin: it delegates to candidateService.updateMarketingInfo
// and maps error.statusCode → HTTP status. These tests verify the status
// passthrough (401/403/404/200) with the service fully stubbed.
//
// candidateController.js imports a heavy dependency graph (database + four
// services + userModel) at module load. We stub them out to keep the import
// cheap — mirrors candidateController.marketingInfoWorklist.test.js. The only
// stub that matters here is candidateService.updateMarketingInfo.
const mockUpdateMarketingInfo = jest.fn();

jest.unstable_mockModule('../src/models/Candidate.js', () => ({
  __esModule: true,
  candidateModel: { collection: {} },
  marketingInfoMissingFilter: () => ({ $or: [] }),
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.unstable_mockModule('../src/config/database.js', () => ({ database: { getCollection: jest.fn() } }));
jest.unstable_mockModule('../src/models/User.js', () => ({ userModel: {} }));
jest.unstable_mockModule('../src/services/storageService.js', () => ({ storageService: {} }));
jest.unstable_mockModule('../src/services/resumeProfileService.js', () => ({ resumeProfileService: {} }));
jest.unstable_mockModule('../src/services/candidateService.js', () => ({
  candidateService: { updateMarketingInfo: mockUpdateMarketingInfo },
}));
jest.unstable_mockModule('../src/services/candidateStatusService.js', () => ({ candidateStatusService: {} }));

const { candidateController } = await import('../src/controllers/candidateController.js');

function res() {
  const r = { statusCode: 200, body: undefined };
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((p) => { r.body = p; return r; });
  return r;
}

beforeEach(() => { jest.clearAllMocks(); });

describe('candidateController.updateMarketingInfo', () => {
  it('401 when unauthenticated (does NOT call the service)', async () => {
    const r = res();
    await candidateController.updateMarketingInfo({ params: { id: 'c1' }, body: {} }, r);
    expect(r.statusCode).toBe(401);
    expect(mockUpdateMarketingInfo).not.toHaveBeenCalled();
  });

  it('200 + candidate on success, forwarding only the 4 marketing fields', async () => {
    mockUpdateMarketingInfo.mockResolvedValue({ _id: 'c1', visaType: 'H1B', company: 'SST' });
    const r = res();
    await candidateController.updateMarketingInfo(
      {
        user: { email: 'rec@x.com', role: 'recruiter' },
        params: { id: 'c1' },
        body: { visaType: 'H1B', company: 'SST', eadStartDate: null, eadEndDate: null, status: 'Active' },
      },
      r
    );
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ success: true, candidate: { visaType: 'H1B', company: 'SST' } });
    // Controller forwards ONLY the 4 marketing fields — never `status`.
    expect(mockUpdateMarketingInfo).toHaveBeenCalledWith(
      { email: 'rec@x.com', role: 'recruiter' },
      'c1',
      { visaType: 'H1B', company: 'SST', eadStartDate: null, eadEndDate: null }
    );
    expect(mockUpdateMarketingInfo.mock.calls[0][2]).not.toHaveProperty('status');
  });

  it('403 passthrough when the service rejects with statusCode 403 (out-of-scope / wrong role)', async () => {
    mockUpdateMarketingInfo.mockRejectedValue(Object.assign(new Error('forbidden'), { statusCode: 403 }));
    const r = res();
    await candidateController.updateMarketingInfo(
      { user: { email: 'rec@x.com', role: 'recruiter' }, params: { id: 'c1' }, body: { visaType: 'H1B' } },
      r
    );
    expect(r.statusCode).toBe(403);
    expect(r.body).toMatchObject({ success: false, error: 'forbidden' });
  });

  it('404 passthrough when the candidate is not found', async () => {
    mockUpdateMarketingInfo.mockRejectedValue(Object.assign(new Error('Candidate not found'), { statusCode: 404 }));
    const r = res();
    await candidateController.updateMarketingInfo(
      { user: { email: 'mm@x.com', role: 'mm' }, params: { id: 'missing' }, body: { visaType: 'H1B' } },
      r
    );
    expect(r.statusCode).toBe(404);
    expect(r.body).toMatchObject({ success: false, error: 'Candidate not found' });
  });

  it('400 passthrough for sanitizer / validation errors', async () => {
    mockUpdateMarketingInfo.mockRejectedValue(Object.assign(new Error('EAD Start Date is required for visa type OPT'), { statusCode: 400 }));
    const r = res();
    await candidateController.updateMarketingInfo(
      { user: { email: 'mm@x.com', role: 'mm' }, params: { id: 'c1' }, body: { visaType: 'OPT' } },
      r
    );
    expect(r.statusCode).toBe(400);
    expect(r.body).toMatchObject({ success: false, error: /EAD Start Date is required/ });
  });
});
