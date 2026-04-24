import express from 'express';
import { authenticateHTTP } from '../middleware/auth.js';
import { poController } from '../controllers/poController.js';

const router = express.Router();

router.use(authenticateHTTP);

// Important: specific routes before param routes to avoid conflicts
router.post('/',                        (req, res) => poController.createOrUpdate(req, res));
router.get('/',                         (req, res) => poController.list(req, res));
router.get('/candidate/:candidateId',   (req, res) => poController.getByCandidateId(req, res));
router.post('/:id/draft-email',         (req, res) => poController.createDraftEmail(req, res));
router.delete('/:id',                   (req, res) => poController.remove(req, res));

export default router;
