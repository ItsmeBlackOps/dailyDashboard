import express from 'express';
import { authenticateHTTP } from '../middleware/auth.js';
import { profileController } from '../controllers/profileController.js';

const router = express.Router();

router.use(authenticateHTTP);

router.get('/me', profileController.getCurrentUserProfile);
router.put('/me', profileController.updateCurrentUserProfile);

export default router;
