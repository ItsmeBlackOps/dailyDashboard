import express from 'express';
import { authenticateHTTP } from '../middleware/auth.js';
import { jobsController as ctl } from '../controllers/jobsController.js';
import { jobsPoolController as poolCtl } from '../controllers/jobsPoolController.js';

const router = express.Router();

router.use(authenticateHTTP);

router.post('/search',                       ctl.searchJobs);
router.get('/sessions',                      ctl.listSessions);
router.get('/sessions/:sessionId',           ctl.getSession);
router.post('/sessions/:sessionId/tailor',   ctl.tailorResume);
router.get('/tailored/:tailoredId',          ctl.getTailored);

// Shared jobs pool — matched per-candidate from previously-scraped data.
router.get('/pool/stats',                    poolCtl.stats);
router.post('/pool/import',                  poolCtl.triggerImport);
router.get('/matched/:candidateId',          poolCtl.matchForCandidate);

export default router;
