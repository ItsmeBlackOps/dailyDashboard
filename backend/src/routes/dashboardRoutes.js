import express from 'express';
import { dashboardController } from '../controllers/dashboardController.js';
import { authenticateHTTP } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticateHTTP);

router.get('/stats/overview', (req, res) => dashboardController.getOverviewStats(req, res));
router.get('/stats/recruiter', (req, res) => dashboardController.getRecruiterStats(req, res));
router.get('/stats/recruiter/drilldown', (req, res) => dashboardController.getRecruiterDrilldown(req, res));
router.get('/stats/expert', (req, res) => dashboardController.getExpertStats(req, res));
router.get('/stats/expert/drilldown', (req, res) => dashboardController.getExpertDrilldown(req, res));
router.get('/stats/management', (req, res) => dashboardController.getManagementStats(req, res));
router.get('/stats/management/drilldown', (req, res) => dashboardController.getManagementDrilldown(req, res));

export default router;
