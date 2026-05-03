import express from 'express';
import { userController } from '../controllers/userController.js';
import { authenticateHTTP, requireHTTPRole } from '../middleware/auth.js';

const router = express.Router();

// All user routes require authentication
router.use(authenticateHTTP);

// General user routes
router.get('/health', userController.healthCheck);
router.get('/active', userController.getActiveUsers);
router.get('/team', userController.getTeamMembers);
router.get('/manageable', requireHTTPRole(['admin', 'mm', 'mam', 'mlead', 'lead', 'am']), userController.getManageableUsers);
router.get('/search', userController.searchUsers);

router.post('/bulk', requireHTTPRole(['admin', 'mm', 'mam', 'mlead', 'lead', 'am']), userController.bulkCreateUsers);
router.put('/bulk', requireHTTPRole(['admin', 'mm', 'mam', 'mlead', 'lead', 'am']), userController.bulkUpdateUsers);

// User profile routes
router.get('/profile/:email', userController.getUserProfile);
router.get('/profile/:email/history', userController.getUserChangeHistory);
router.put('/profile/:email', userController.updateUserProfile);
router.put('/profile/:email/password', userController.updateUserPassword);

// Admin / branch-manager only routes
router.get('/', requireHTTPRole(['admin', 'mm']), userController.getAllUsers);
router.get('/role/:role', requireHTTPRole(['admin', 'mm', 'lead', 'am']), userController.getUsersByRole);
router.get('/stats', requireHTTPRole(['admin', 'mm']), userController.getUserStats);

// Role / team-lead mutation now allows mm/mam/am (C14) — scope enforcement
// happens inside the service via canManageTargetRole.
router.put('/:email/role', requireHTTPRole(['admin', 'mm', 'mam', 'am']), userController.updateUserRole);
router.put('/:email/team-lead', requireHTTPRole(['admin', 'mm', 'mam', 'am']), userController.updateUserTeamLead);
router.delete('/:email', requireHTTPRole(['admin']), userController.deleteUser);

export default router;
