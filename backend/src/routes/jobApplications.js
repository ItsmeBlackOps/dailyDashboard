import express from 'express';
import { authenticateHTTP } from '../middleware/auth.js';
import { jobApplicationsController as ctl } from '../controllers/jobApplicationsController.js';

const router = express.Router();
router.use(authenticateHTTP);

// GET    /api/jobs/applications?candidateId=...      list applications for one candidate
// POST   /api/jobs/applications                      upsert (mark applied / move status)
// DELETE /api/jobs/applications                      remove (un-apply); body { candidateId, jobId }
// PATCH  /api/jobs/applications/:id/status           change status by application id
router.get('/',                  (req, res) => ctl.list(req, res));
router.post('/',                 (req, res) => ctl.upsert(req, res));
router.delete('/',               (req, res) => ctl.remove(req, res));
router.patch('/:id/status',      (req, res) => ctl.updateStatus(req, res));

export default router;
