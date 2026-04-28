import express from 'express';
import { authenticateHTTP } from '../middleware/auth.js';
import { jobsController as ctl } from '../controllers/jobsController.js';

const router = express.Router();

router.use(authenticateHTTP);

router.post('/search',                       ctl.searchJobs);
router.get('/sessions',                      ctl.listSessions);
router.get('/sessions/:sessionId',           ctl.getSession);
router.post('/sessions/:sessionId/tailor',   ctl.tailorResume);
router.get('/tailored/:tailoredId',          ctl.getTailored);

export default router;
