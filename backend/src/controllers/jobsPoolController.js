import { jobsPoolService } from '../services/jobsPoolService.js';
import { logger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/errorHandler.js';

class JobsPoolController {
  matchForCandidate = asyncHandler(async (req, res) => {
    const { candidateId } = req.params;
    const limit = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;
    try {
      const result = await jobsPoolService.matchForCandidate({ candidateId, limit, offset });
      return res.json({ success: true, ...result });
    } catch (err) {
      logger.error('jobsPool matchForCandidate failed', { candidateId, error: err.message });
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  stats = asyncHandler(async (_req, res) => {
    const s = await jobsPoolService.stats();
    return res.json({ success: true, ...s });
  });
}

export const jobsPoolController = new JobsPoolController();
