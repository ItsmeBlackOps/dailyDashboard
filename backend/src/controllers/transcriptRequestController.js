import { asyncHandler } from '../middleware/errorHandler.js';
import { transcriptRequestService } from '../services/transcriptRequestService.js';

class TranscriptRequestController {
  createTranscriptRequest = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const result = await transcriptRequestService.requestTranscriptAccess({
      taskId,
      user: req.user
    });

    res.status(200).json({
      success: true,
      message: result.message,
      request: result.request
    });
  });

  getMyTranscriptRequestStatus = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const status = await transcriptRequestService.getMyTaskRequestStatus({
      taskId,
      user: req.user
    });

    res.status(200).json({
      success: true,
      status
    });
  });

  getMyTranscriptRequestStatuses = asyncHandler(async (req, res) => {
    const taskIds = Array.isArray(req.body?.taskIds) ? req.body.taskIds : [];
    const result = await transcriptRequestService.getMyTaskRequestStatuses({
      taskIds,
      user: req.user
    });

    res.status(200).json({
      success: true,
      statuses: result.statuses
    });
  });

  getTaskTranscript = asyncHandler(async (req, res) => {
    const { taskId } = req.params;
    const result = await transcriptRequestService.getTranscriptForTask({
      taskId,
      user: req.user
    });

    res.status(200).json({
      success: true,
      title: result.title,
      transcriptText: result.transcriptText,
      generatedAt: result.generatedAt
    });
  });

  listTranscriptRequests = asyncHandler(async (req, res) => {
    const status = typeof req.query?.status === 'string' ? req.query.status : '';
    const limit = typeof req.query?.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined;

    const result = await transcriptRequestService.listTranscriptRequests({
      status,
      limit,
      user: req.user
    });

    res.status(200).json({
      success: true,
      requests: result.requests
    });
  });

  reviewTranscriptRequest = asyncHandler(async (req, res) => {
    const { requestId } = req.params;
    const action = typeof req.body?.action === 'string' ? req.body.action : '';
    const note = typeof req.body?.note === 'string' ? req.body.note : '';

    const result = await transcriptRequestService.reviewTranscriptRequest({
      requestId,
      action,
      note,
      user: req.user
    });

    res.status(200).json({
      success: true,
      request: result.request
    });
  });

  getPendingRequestCount = asyncHandler(async (req, res) => {
    const result = await transcriptRequestService.getPendingTranscriptRequestCount({
      user: req.user
    });

    res.status(200).json({
      success: true,
      count: result.count
    });
  });
}

export const transcriptRequestController = new TranscriptRequestController();
