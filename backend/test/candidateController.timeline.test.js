import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Harness mirrors candidateController.getCandidateById.test.js: stub the heavy
// dependency graph the controller imports at module load, then exercise the
// thin getCandidateTimeline handler, which delegates to
// candidateService.getCandidateTimeline and maps statusCode → HTTP.
const mockGetCandidateTimeline = jest.fn();

jest.unstable_mockModule('../src/models/Candidate.js', () => ({
  __esModule: true,
  candidateModel: { collection: { findOne: jest.fn() } },
  marketingInfoMissingFilter: () => ({ $or: [] }),
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.unstable_mockModule('../src/config/database.js', () => ({ database: { getCollection: jest.fn() } }));
jest.unstable_mockModule('../src/models/User.js', () => ({ userModel: {} }));
jest.unstable_mockModule('../src/services/storageService.js', () => ({ storageService: {} }));
jest.unstable_mockModule('../src/services/resumeProfileService.js', () => ({ resumeProfileService: {} }));
jest.unstable_mockModule('../src/services/candidateService.js', () => ({ candidateService: { getCandidateTimeline: mockGetCandidateTimeline } }));
jest.unstable_mockModule('../src/services/candidateStatusService.js', () => ({ candidateStatusService: {} }));

const { candidateController } = await import('../src/controllers/candidateController.js');

const VALID_ID = 'a'.repeat(24);

function res() {
  const r = { statusCode: 200, body: undefined };
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((p) => { r.body = p; return r; });
  return r;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCandidateTimeline.mockResolvedValue([
    { id: 'assignmentEmails:0', ts: new Date('2026-06-02T09:00:00Z'), type: 'assignment_email', label: 'Assignment email sent to rec@x.com', actor: 'mm@x.com', detail: {}, source: 'assignmentEmails' },
    { id: 'statusHistory:0', ts: new Date('2026-06-01T11:00:00Z'), type: 'status_changed', label: 'Status: New → Active', actor: 'mm@x.com', detail: {}, source: 'statusHistory' },
  ]);
});

describe('candidateController.getCandidateTimeline', () => {
  it('200 returns { success, timeline }', async () => {
    const r = res();
    await candidateController.getCandidateTimeline({ user: { email: 'a@x.com', role: 'admin' }, params: { id: VALID_ID } }, r);
    expect(r.statusCode).toBe(200);
    expect(r.body.success).toBe(true);
    expect(Array.isArray(r.body.timeline)).toBe(true);
    expect(r.body.timeline).toHaveLength(2);
    expect(r.body.timeline[0].type).toBe('assignment_email');
    // Delegates to the service with the authenticated user + the route id.
    expect(mockGetCandidateTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'admin' }),
      VALID_ID,
    );
  });

  it('401 when unauthenticated (no req.user)', async () => {
    const r = res();
    await candidateController.getCandidateTimeline({ params: { id: VALID_ID } }, r);
    expect(r.statusCode).toBe(401);
    expect(mockGetCandidateTimeline).not.toHaveBeenCalled();
  });

  it('maps a service 404 to a 404 response', async () => {
    const err = new Error('Candidate not found');
    err.statusCode = 404;
    mockGetCandidateTimeline.mockRejectedValueOnce(err);
    const r = res();
    await candidateController.getCandidateTimeline({ user: { email: 'a@x.com', role: 'admin' }, params: { id: VALID_ID } }, r);
    expect(r.statusCode).toBe(404);
    expect(r.body.success).toBe(false);
  });

  it('maps a service 400 to a 400 response', async () => {
    const err = new Error('Candidate id is required');
    err.statusCode = 400;
    mockGetCandidateTimeline.mockRejectedValueOnce(err);
    const r = res();
    await candidateController.getCandidateTimeline({ user: { email: 'a@x.com', role: 'admin' }, params: { id: '' } }, r);
    expect(r.statusCode).toBe(400);
    expect(r.body.success).toBe(false);
  });

  it('masks an unexpected error as 500 "Unable to load timeline"', async () => {
    mockGetCandidateTimeline.mockRejectedValueOnce(new Error('boom'));
    const r = res();
    await candidateController.getCandidateTimeline({ user: { email: 'a@x.com', role: 'admin' }, params: { id: VALID_ID } }, r);
    expect(r.statusCode).toBe(500);
    expect(r.body.error).toBe('Unable to load timeline');
  });
});
