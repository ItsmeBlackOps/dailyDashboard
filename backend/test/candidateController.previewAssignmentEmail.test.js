import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// Harness mirrors candidateController.getCandidateById.test.js: stub the heavy
// dependency graph the controller imports at module load. This suite exercises
// previewAssignmentEmail, which delegates entirely to
// candidateService.buildAssignmentEmailPreview, so that service is mocked.
const mockPreview = jest.fn();

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
jest.unstable_mockModule('../src/services/candidateService.js', () => ({ candidateService: { buildAssignmentEmailPreview: mockPreview } }));
jest.unstable_mockModule('../src/services/candidateStatusService.js', () => ({ candidateStatusService: {} }));

const { candidateController } = await import('../src/controllers/candidateController.js');

const VALID_ID = 'a'.repeat(24); // 24-hex → real ObjectId() accepts it

function res() {
  const r = { statusCode: 200, body: undefined };
  r.status = jest.fn((c) => { r.statusCode = c; return r; });
  r.json = jest.fn((p) => { r.body = p; return r; });
  return r;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('candidateController.previewAssignmentEmail', () => {
  it('200 returns the preview shape', async () => {
    mockPreview.mockResolvedValue({
      to: ['rec@x.com'],
      cc: ['tl@x.com'],
      bcc: [],
      subject: 'Assignment: Asha',
      bodyHtml: '<p>Hi</p>',
      attachments: [{ id: 'a1', filename: 'r.pdf' }],
    });
    const r = res();
    await candidateController.previewAssignmentEmail(
      { user: { email: 'a@x.com', role: 'admin' }, params: { id: VALID_ID }, body: {} },
      r,
    );
    expect(r.statusCode).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.preview.to).toEqual(['rec@x.com']);
    expect(mockPreview).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@x.com', role: 'admin' }),
      VALID_ID,
      expect.objectContaining({ appendBody: undefined, attachmentIds: undefined, subject: undefined }),
    );
  });

  it('maps a service 400 (gate failure)', async () => {
    const e = new Error('At least one attachment is required to send the assignment email');
    e.statusCode = 400;
    mockPreview.mockRejectedValue(e);
    const r = res();
    await candidateController.previewAssignmentEmail(
      { user: { email: 'a@x.com', role: 'admin' }, params: { id: VALID_ID }, body: {} },
      r,
    );
    expect(r.statusCode).toBe(400);
    expect(r.body.success).toBe(false);
    expect(r.body.error).toMatch(/attachment/i);
  });
});
