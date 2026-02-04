import express from 'express';
import { permissionController } from '../controllers/permissionController.js';

const router = express.Router();

// Get all roles with permissions
router.get('/roles', (req, res) => permissionController.getAllRoles(req, res));

// Get permissions for a specific role
router.get('/roles/:role', (req, res) => permissionController.getRolePermissions(req, res));

// Update permissions for a specific role
router.put('/roles/:role', (req, res) => permissionController.updateRolePermissions(req, res));

// Delete a role
router.delete('/roles/:role', (req, res) => permissionController.deleteRole(req, res));

// Get list of all available permissions
router.get('/available', (req, res) => permissionController.getAvailablePermissions(req, res));

// Seed initial permissions
router.post('/seed', (req, res) => permissionController.seedPermissions(req, res));

export default router;
