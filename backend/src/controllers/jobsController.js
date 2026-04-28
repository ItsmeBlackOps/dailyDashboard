import { jobSearchService } from '../services/jobSearchService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

class JobsController {
  /**
   * POST /api/jobs/search
   * Body: { candidateId, candidateName?, filters }
   */
  searchJobs = asyncHandler(async (req, res) => {
    const { candidateId, candidateName, filters } = req.body;
    if (!candidateId) {
      return res.status(400).json({ success: false, error: 'candidateId is required' });
    }
    if (!filters || typeof filters !== 'object') {
      return res.status(400).json({ success: false, error: 'filters object is required' });
    }

    const requestedBy = req.user?.email || '';
    const result = await jobSearchService.startSearch({ candidateId, candidateName, filters, requestedBy });
    return res.status(202).json({ success: true, ...result });
  });

  /**
   * GET /api/jobs/sessions/:sessionId
   */
  getSession = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const session = await jobSearchService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }
    return res.json({ success: true, session });
  });

  /**
   * GET /api/jobs/sessions?candidateId=&limit=&page=
   */
  listSessions = asyncHandler(async (req, res) => {
    const { candidateId, limit, page } = req.query;
    if (!candidateId) {
      return res.status(400).json({ success: false, error: 'candidateId is required' });
    }
    const result = await jobSearchService.listSessions({
      candidateId,
      limit: limit ? Number.parseInt(limit, 10) : 20,
      page: page ? Number.parseInt(page, 10) : 1,
    });
    return res.json({ success: true, ...result });
  });

  /**
   * POST /api/jobs/sessions/:sessionId/tailor
   * Body: { jobId }
   */
  tailorResume = asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { jobId } = req.body;
    if (!jobId) {
      return res.status(400).json({ success: false, error: 'jobId is required' });
    }
    const requestedBy = req.user?.email || '';
    const result = await jobSearchService.triggerTailor({ sessionId, jobId, requestedBy });
    return res.status(202).json({ success: true, ...result });
  });

  /**
   * GET /api/jobs/tailored/:tailoredId
   */
  getTailored = asyncHandler(async (req, res) => {
    const { tailoredId } = req.params;
    const doc = await jobSearchService.getTailored(tailoredId);
    if (!doc) {
      return res.status(404).json({ success: false, error: 'Tailored resume not found' });
    }
    return res.json({ success: true, tailored: doc });
  });
}

export const jobsController = new JobsController();
