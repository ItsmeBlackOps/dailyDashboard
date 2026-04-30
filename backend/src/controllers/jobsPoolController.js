import { jobsPoolService } from '../services/jobsPoolService.js';
import { _runImporter as runImporterNow } from '../jobs/jobsPoolImportScheduler.js';
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

  // Admin-only on-demand trigger. Kicks off the same cycle the scheduler
  // runs every JOBS_POOL_IMPORT_INTERVAL_HOURS. Returns immediately —
  // the import runs as a child process; tail backend logs to follow.
  triggerImport = asyncHandler(async (req, res) => {
    const role = (req.user?.role || '').trim().toLowerCase();
    if (role !== 'admin') {
      return res.status(403).json({ success: false, error: 'admin only' });
    }
    runImporterNow();
    return res.json({
      success: true,
      message: 'jobsPool import cycle triggered — see backend logs for progress',
    });
  });
}

export const jobsPoolController = new JobsPoolController();
