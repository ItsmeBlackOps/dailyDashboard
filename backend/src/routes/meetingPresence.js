import express from 'express';
import { meetingPresenceController } from '../controllers/meetingPresenceController.js';
import { authenticateHTTP, authenticateMeetingDetector } from '../middleware/auth.js';

const router = express.Router();

// Enroll: logged-in expert mints their extension token (normal auth).
router.post('/enroll', authenticateHTTP, meetingPresenceController.enroll);

// Report: the extension posts presence with its scoped detector token only.
router.post('/report', authenticateMeetingDetector, meetingPresenceController.report);

export default router;
