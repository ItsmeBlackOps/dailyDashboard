import express from 'express';
import { graphMeetingController } from '../controllers/graphMeetingController.js';
import { graphMailController } from '../controllers/graphMailController.js';

const router = express.Router();

router.get('/health/meetings', (req, res) => graphMeetingController.health(req, res));
router.post('/meetings', (req, res) => graphMeetingController.createMeeting(req, res));
router.post('/mail/send', (req, res) => graphMailController.sendMail(req, res));

export default router;
