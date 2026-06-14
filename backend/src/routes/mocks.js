// Mock Support routes. Authentication FIRST (the delegations/fireflies
// gap lesson — #240/#249), then the controller. Per-action authority is
// enforced in the service against the candidate/watcher context.

import { Router } from 'express';
import { authenticateHTTP } from '../middleware/auth.js';
import { mockController } from '../controllers/mockController.js';

const router = Router();
router.use(authenticateHTTP);

// Create-form helpers
router.get('/eligible/candidates', mockController.eligibleCandidates);
router.get('/candidate/:emailId/interviews', mockController.candidateInterviews);

// CRUD + status machine
router.post('/', mockController.create);
router.get('/', mockController.list);
router.get('/:id', mockController.detail);
router.post('/:id/start', mockController.start);
router.post('/:id/call-attempt', mockController.callAttempt);
router.post('/:id/schedule', mockController.schedule);
router.post('/:id/blocker', mockController.blocker);
router.patch('/:id/blocker', mockController.resolveBlocker);
router.patch('/:id/checklist', mockController.checklist);
router.post('/:id/connected', mockController.connected);
router.post('/:id/feedback', mockController.feedback);
router.post('/:id/cancel', mockController.cancel);

export default router;
