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
router.get('/manageable', requireHTTPRole(['admin', 'manager', 'MM', 'MAM', 'mlead', 'lead', 'AM', 'am']), userController.getManageableUsers);
router.get('/search', userController.searchUsers);

router.post('/bulk', requireHTTPRole(['admin', 'manager', 'MM', 'MAM', 'mlead', 'lead', 'AM', 'am']), userController.bulkCreateUsers);
router.put('/bulk', requireHTTPRole(['admin', 'manager', 'MM', 'MAM', 'mlead', 'lead', 'AM', 'am']), userController.bulkUpdateUsers);

// User profile routes
router.get('/profile/:email', userController.getUserProfile);
router.put('/profile/:email', userController.updateUserProfile);
router.put('/profile/:email/password', userController.updateUserPassword);

// Admin/Manager only routes
router.get('/', requireHTTPRole(['admin', 'manager']), userController.getAllUsers);
router.get('/role/:role', requireHTTPRole(['admin', 'manager', 'lead', 'AM', 'am']), userController.getUsersByRole);
router.get('/stats', requireHTTPRole(['admin', 'manager']), userController.getUserStats);

router.put('/:email/role', requireHTTPRole(['admin', 'manager']), userController.updateUserRole);
router.put('/:email/team-lead', requireHTTPRole(['admin', 'manager']), userController.updateUserTeamLead);
router.delete('/:email', requireHTTPRole(['admin']), userController.deleteUser);

export default router;
