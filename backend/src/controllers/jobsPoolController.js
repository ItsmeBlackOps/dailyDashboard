import { jobsPoolService } from '../services/jobsPoolService.js';
import { poolRefresherService } from '../services/poolRefresherService.js';
import { candidateService } from '../services/candidateService.js';
import { _runImporter as runImporterNow } from '../jobs/jobsPoolImportScheduler.js';
import { logger } from '../utils/logger.js';
import { asyncHandler } from '../middleware/errorHandler.js';

// Build the lowercased recruiter-email set the user is allowed to see
// candidates for. Returns null for admins (no scope — global view).
function recruiterScopeFor(user) {
  if (!user) return new Set();
  const role = (user.role || '').trim().toLowerCase();
  if (role === 'admin') return null;
  const set = candidateService.resolveActiveHierarchyEmails(user) || new Set();
  return new Set([...set].map((e) => e.toLowerCase()));
}

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

  list = asyncHandler(async (req, res) => {
    const candidateId = req.query.candidateId ? String(req.query.candidateId) : undefined;
    const query  = req.query.q ? String(req.query.q) : undefined;
    const limit  = parseInt(req.query.limit,  10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    try {
      const scopeRecruiterEmails = recruiterScopeFor(req.user);
      const result = await jobsPoolService.listPool({
        candidateId, query, limit, offset, scopeRecruiterEmails,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      logger.error('jobsPool list failed', { error: err.message });
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  triggerRefresh = asyncHandler(async (req, res) => {
    const role = (req.user?.role || '').trim().toLowerCase();
    if (role !== 'admin') {
      return res.status(403).json({ success: false, error: 'admin only' });
    }
    const which = String(req.query.actor || 'fantastic').toLowerCase();
    try {
      const r = which.startsWith('linkedin')
        ? await poolRefresherService.triggerLinkedIn()
        : await poolRefresherService.triggerFantasticJobs();
      return res.json({ success: true, actor: which, ...r });
    } catch (err) {
      logger.error('jobsPool triggerRefresh failed', { actor: which, error: err.message });
      return res.status(500).json({ success: false, actor: which, error: err.message });
    }
  });

  refreshStats = asyncHandler(async (_req, res) => {
    const s = await poolRefresherService.stats();
    return res.json({ success: true, state: s });
  });

  pruneNonUS = asyncHandler(async (req, res) => {
    const role = (req.user?.role || '').trim().toLowerCase();
    if (role !== 'admin') {
      return res.status(403).json({ success: false, error: 'admin only' });
    }
    const dryRun = req.query.dry === '1' || req.query.dry === 'true';
    const r = await jobsPoolService.pruneNonUS({ dryRun });
    return res.json({ success: true, dryRun, ...r });
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
