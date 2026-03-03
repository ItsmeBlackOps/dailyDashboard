import { jest } from '@jest/globals';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

const mockTaskService = {
  getTaskById: jest.fn()
};

const mockTranscriptRequestModel = {
  upsertPendingRequest: jest.fn(),
  getRequestForUser: jest.fn(),
  getRequestsForUserByTaskIds: jest.fn(),
  listRequests: jest.fn(),
  updateRequestStatus: jest.fn(),
  countPendingRequests: jest.fn()
};

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: mockLogger
}));

jest.unstable_mockModule('../taskService.js', () => ({
  taskService: mockTaskService
}));

jest.unstable_mockModule('../../models/TranscriptRequest.js', () => ({
  transcriptRequestModel: mockTranscriptRequestModel,
  TRANSCRIPT_REQUEST_STATUS: {
    pending: 'pending',
    approved: 'approved',
    rejected: 'rejected'
  }
}));

const { transcriptRequestService } = await import('../transcriptRequestService.js');
const { config } = await import('../../config/index.js');

describe('transcriptRequestService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    transcriptRequestService.databases = {
      listDocuments: jest.fn()
    };
    config.appwrite.databaseId = 'db';
    config.appwrite.transcriptsCollectionId = 'transcripts';
  });

  it('creates transcript request for visible task with TxAv', async () => {
    mockTaskService.getTaskById.mockResolvedValue({
      task: {
        _id: 'task-1',
        subject: 'Interview Subject',
        transcription: true,
        'Candidate Name': 'Jane Candidate',
        'Date of Interview': '03/03/2026',
        'Interview Round': 'Final Round'
      }
    });

    transcriptRequestService.databases.listDocuments.mockResolvedValue({
      documents: [{ $id: 'doc-1', title: 'Interview Subject' }]
    });

    mockTranscriptRequestModel.upsertPendingRequest.mockResolvedValue({
      request: {
        id: 'req-1',
        taskId: 'task-1',
        status: 'pending',
        requestedBy: 'recruiter@example.com'
      },
      created: true,
      reactivated: false
    });

    const result = await transcriptRequestService.requestTranscriptAccess({
      taskId: 'task-1',
      user: {
        email: 'recruiter@example.com',
        role: 'recruiter',
        teamLead: 'lead@example.com',
        manager: 'manager@example.com'
      }
    });

    expect(result.request.status).toBe('pending');
    expect(result.message).toBe('Transcript request submitted for admin approval.');
    expect(mockTranscriptRequestModel.upsertPendingRequest).toHaveBeenCalledTimes(1);
    expect(transcriptRequestService.databases.listDocuments).toHaveBeenCalledTimes(1);
  });

  it('blocks transcript access for non-admin when request is not approved', async () => {
    mockTaskService.getTaskById.mockResolvedValue({
      task: {
        _id: 'task-1',
        subject: 'Interview Subject'
      }
    });

    mockTranscriptRequestModel.getRequestForUser.mockResolvedValue({
      id: 'req-1',
      taskId: 'task-1',
      status: 'pending'
    });

    await expect(
      transcriptRequestService.getTranscriptForTask({
        taskId: 'task-1',
        user: {
          email: 'recruiter@example.com',
          role: 'recruiter',
          teamLead: 'lead@example.com',
          manager: 'manager@example.com'
        }
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      message: 'Transcript access is not approved yet.'
    });
  });

  it('returns transcript text when request is approved', async () => {
    mockTaskService.getTaskById.mockResolvedValue({
      task: {
        _id: 'task-1',
        subject: 'Interview Subject'
      }
    });

    mockTranscriptRequestModel.getRequestForUser.mockResolvedValue({
      id: 'req-1',
      taskId: 'task-1',
      status: 'approved'
    });

    transcriptRequestService.databases.listDocuments.mockResolvedValue({
      documents: [{
        title: 'Interview Subject',
        sentences: [
          { speaker_name: 'Interviewer', raw_text: 'Tell me about your latest project.', start_seconds: 12 },
          { speaker_name: 'Candidate', raw_text: 'I led a migration project.', start_seconds: 22 }
        ]
      }]
    });

    const result = await transcriptRequestService.getTranscriptForTask({
      taskId: 'task-1',
      user: {
        email: 'recruiter@example.com',
        role: 'recruiter',
        teamLead: 'lead@example.com',
        manager: 'manager@example.com'
      }
    });

    expect(result.title).toBe('Interview Subject');
    expect(result.transcriptText).toContain('[00:12] Interviewer: Tell me about your latest project.');
    expect(result.transcriptText).toContain('[00:22] Candidate: I led a migration project.');
  });

  it('requires admin role to review transcript requests', async () => {
    await expect(
      transcriptRequestService.reviewTranscriptRequest({
        requestId: '67d5c85f0bd4f4f3f8e8e8e8',
        action: 'approve',
        note: 'approved',
        user: {
          email: 'lead@example.com',
          role: 'lead'
        }
      })
    ).rejects.toMatchObject({
      statusCode: 403
    });
  });

  it('returns statuses only for tasks visible to the current user', async () => {
    mockTaskService.getTaskById
      .mockResolvedValueOnce({ task: { _id: 'task-1', subject: 'A' } })
      .mockRejectedValueOnce(new Error('Access denied'));

    mockTranscriptRequestModel.getRequestsForUserByTaskIds.mockResolvedValue([
      {
        taskId: 'task-1',
        status: 'approved',
        requestedAt: '2026-03-03T10:00:00.000Z',
        reviewedAt: '2026-03-03T10:10:00.000Z',
        reviewNote: 'approved'
      }
    ]);

    const result = await transcriptRequestService.getMyTaskRequestStatuses({
      taskIds: ['task-1', 'task-2'],
      user: {
        email: 'recruiter@example.com',
        role: 'recruiter',
        teamLead: 'lead@example.com',
        manager: 'manager@example.com'
      }
    });

    expect(result.statuses).toEqual({
      'task-1': {
        status: 'approved',
        requestedAt: '2026-03-03T10:00:00.000Z',
        reviewedAt: '2026-03-03T10:10:00.000Z',
        reviewNote: 'approved'
      }
    });
    expect(mockTranscriptRequestModel.getRequestsForUserByTaskIds).toHaveBeenCalledWith(
      ['task-1'],
      'recruiter@example.com'
    );
  });
});
