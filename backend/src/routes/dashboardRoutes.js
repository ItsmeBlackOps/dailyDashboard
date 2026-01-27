import express from 'express';
import { dashboardController } from '../controllers/dashboardController.js';
import { authenticateHTTP } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateHTTP);

router.get('/stats/recruiter', (req, res) => dashboardController.getRecruiterStats(req, res));
router.get('/stats/expert', (req, res) => dashboardController.getExpertStats(req, res));
router.get('/stats/management', (req, res) => dashboardController.getManagementStats(req, res));

export default router;
