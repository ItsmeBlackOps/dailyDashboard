import express from 'express';
import { authController } from '../controllers/authController.js';
import { authenticateHTTP, requireHTTPRole } from '../middleware/auth.js';
import { validateLoginData, validateRefreshToken, validateUserCreation } from '../middleware/validation.js';

const router = express.Router();

// Public routes
router.post('/login', validateLoginData, authController.login);
router.post('/refresh', validateRefreshToken, authController.refresh);
router.post('/logout', authController.logout);
router.get('/health', authController.healthCheck);

// Protected routes
router.use(authenticateHTTP);

router.get('/profile', authController.getProfile);
router.put('/profile', authController.updateProfile);
router.post('/logout-all', authController.logoutAll);

// Admin only routes
router.post('/users', requireHTTPRole(['admin', 'mm']), validateUserCreation, authController.createUser);
router.get('/stats', requireHTTPRole(['admin', 'mm']), authController.getStats);

export default router;