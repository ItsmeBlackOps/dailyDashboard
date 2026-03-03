import express from 'express';
import { authenticateHTTP } from '../middleware/auth.js';
import { transcriptRequestController } from '../controllers/transcriptRequestController.js';

const router = express.Router();

router.use(authenticateHTTP);

router.get('/', transcriptRequestController.listTranscriptRequests);
router.get('/pending-count', transcriptRequestController.getPendingRequestCount);
router.put('/:requestId', transcriptRequestController.reviewTranscriptRequest);

export default router;
