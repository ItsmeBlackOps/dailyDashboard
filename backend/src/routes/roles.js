import express from 'express';
import { roleController } from '../controllers/roleController.js';
import { authenticateHTTP, requireHTTPRole } from '../middleware/auth.js';

const router = express.Router();

// All role routes require authentication and Admin access
router.use(authenticateHTTP);
router.use(requireHTTPRole(['admin']));

router.get('/', roleController.getAllRoles);
router.put('/:role', roleController.updateRole);

export default router;
