import { supportRequestService } from '../services/supportRequestService.js';
import { asyncHandler } from '../middleware/errorHandler.js';

class SupportRequestController {
  constructor() {
    this.createInterviewSupport = this.createInterviewSupport.bind(this);
    this.createMockSupport = this.createMockSupport.bind(this);
    this.createAssessmentSupport = this.createAssessmentSupport.bind(this);
  }

  createInterviewSupport = asyncHandler(async (req, res) => {
    const graphTokenHeader = req.headers['x-graph-access-token'];
    const graphToken = typeof graphTokenHeader === 'string' ? graphTokenHeader.trim() : '';

    if (!graphToken) {
      return res.status(401).json({ success: false, error: 'missing_graph_token' });
    }

    const result = await supportRequestService.sendInterviewSupportRequest(
      req.user,
      req.body,
      req.files || {},
      graphToken
    );

    res.status(201).json(result);
  });

  createMockSupport = asyncHandler(async (req, res) => {
    const graphTokenHeader = req.headers['x-graph-access-token'];
    const graphToken = typeof graphTokenHeader === 'string' ? graphTokenHeader.trim() : '';

    if (!graphToken) {
      return res.status(401).json({ success: false, error: 'missing_graph_token' });
    }

    const result = await supportRequestService.sendMockInterviewRequest(
      req.user,
      req.body,
      graphToken
    );

    res.status(201).json(result);
  });

  createAssessmentSupport = asyncHandler(async (req, res) => {
    const graphTokenHeader = req.headers['x-graph-access-token'];
    const graphToken = typeof graphTokenHeader === 'string' ? graphTokenHeader.trim() : '';

    if (!graphToken) {
      return res.status(401).json({ success: false, error: 'missing_graph_token' });
    }

    const result = await supportRequestService.sendAssessmentSupportRequest(
      req.user,
      req.body,
      req.files || {},
      graphToken
    );

    res.status(201).json(result);
  });
}

export const supportRequestController = new SupportRequestController();
