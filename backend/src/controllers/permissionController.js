import { rolePermissionModel } from '../models/RolePermission.js';
import { logger } from '../utils/logger.js';

// Normalized RBAC Permission Model
// 30 Capabilities (resource:action) + 3 Scopes (own/team/any) = 33 Total

const AVAILABLE_PERMISSIONS = [
    // Dashboard
    'dashboard:read',

    // Tasks
    'tasks:read',
    'tasks:write',
    'tasks:assign',
    'tasks:meeting',
    'tasks:delete',
    'tasks:support',
    'tasks:mock',

    // Candidates
    'candidates:read',
    'candidates:write',
    'candidates:delete',
    'candidates:export',
    'candidates:import',

    // Resumes
    'resumes:read',
    'resumes:review',
    'resumes:assign',
    'resumes:download',

    // Users
    'users:read',
    'users:manage',
    'users:roles',

    // Reports
    'reports:read',
    'reports:export',
    'reports:schedule',

    // Admin Alerts
    'alerts:manage',

    // System
    'system:settings',
    'audit:read',

    // Notifications
    'notifications:read',
    'notifications:manage',

    // Profile
    'profile:read',
    'profile:write',

    // Permissions
    'permissions:manage',

    // Scopes
    'scope:own',
    'scope:team',
    'scope:any',
];

const PERMISSION_CATEGORIES = {
    dashboard: ['dashboard:read'],
    tasks: ['tasks:read', 'tasks:write', 'tasks:assign', 'tasks:meeting', 'tasks:delete', 'tasks:support', 'tasks:mock'],
    candidates: ['candidates:read', 'candidates:write', 'candidates:delete', 'candidates:export', 'candidates:import'],
    resumes: ['resumes:read', 'resumes:review', 'resumes:assign', 'resumes:download'],
    users: ['users:read', 'users:manage', 'users:roles'],
    reports: ['reports:read', 'reports:export', 'reports:schedule'],
    system: ['alerts:manage', 'system:settings', 'audit:read', 'permissions:manage'],
    notifications: ['notifications:read', 'notifications:manage'],
    profile: ['profile:read', 'profile:write'],
    scopes: ['scope:own', 'scope:team', 'scope:any']
};

class PermissionController {
    // Get all roles with their permissions
    async getAllRoles(req, res) {
        try {
            const user = req.user;

            // Only admins can view permissions
            if (user.role.toLowerCase() !== 'admin') {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }

            const roles = await rolePermissionModel.getAllRoles();

            logger.info('Permissions: getAllRoles', { userEmail: user.email, rolesCount: roles.length });

            res.json({ success: true, data: roles });
        } catch (error) {
            logger.error('Failed to get all roles', { error: error.message });
            res.status(500).json({ success: false, error: 'Failed to fetch roles' });
        }
    }

    // Get permissions for a specific role
    async getRolePermissions(req, res) {
        try {
            const user = req.user;
            const { role } = req.params;

            if (user.role.toLowerCase() !== 'admin') {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }

            const roleDoc = await rolePermissionModel.getRolePermissions(role);

            if (!roleDoc) {
                return res.status(404).json({ success: false, error: 'Role not found' });
            }

            logger.info('Permissions: getRolePermissions', { userEmail: user.email, role });

            res.json({ success: true, data: roleDoc });
        } catch (error) {
            logger.error('Failed to get role permissions', { error: error.message, role: req.params.role });
            res.status(500).json({ success: false, error: 'Failed to fetch role permissions' });
        }
    }

    // Update permissions for a specific role
    async updateRolePermissions(req, res) {
        try {
            const user = req.user;
            const { role } = req.params;
            const { permissions } = req.body;

            if (user.role.toLowerCase() !== 'admin') {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }

            if (!Array.isArray(permissions)) {
                return res.status(400).json({ success: false, error: 'Permissions must be an array' });
            }

            // Validate permissions
            const invalidPermissions = permissions.filter(p => !AVAILABLE_PERMISSIONS.includes(p));
            if (invalidPermissions.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid permissions',
                    invalidPermissions
                });
            }

            const result = await rolePermissionModel.updateRolePermissions(role, permissions, user.email);

            logger.info('Permissions: updateRolePermissions', {
                userEmail: user.email,
                role,
                permissionCount: permissions.length
            });

            res.json({ success: true, data: result });
        } catch (error) {
            logger.error('Failed to update role permissions', { error: error.message, role: req.params.role });
            res.status(500).json({ success: false, error: 'Failed to update permissions' });
        }
    }

    // Get list of all available permissions
    async getAvailablePermissions(req, res) {
        try {
            const user = req.user;

            if (user.role.toLowerCase() !== 'admin') {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }

            res.json({
                success: true,
                data: {
                    permissions: AVAILABLE_PERMISSIONS,
                    categories: PERMISSION_CATEGORIES
                }
            });
        } catch (error) {
            logger.error('Failed to get available permissions', { error: error.message });
            res.status(500).json({ success: false, error: 'Failed to fetch available permissions' });
        }
    }

    // Seed initial permissions from config
    async seedPermissions(req, res) {
        try {
            const user = req.user;

            if (user.role.toLowerCase() !== 'admin') {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }

            const rolePermissionsData = req.body.rolePermissions || {};

            if (Object.keys(rolePermissionsData).length === 0) {
                return res.status(400).json({ success: false, error: 'No role permissions data provided' });
            }

            const result = await rolePermissionModel.seedRolePermissions(rolePermissionsData, user.email);

            logger.info('Permissions: seedPermissions', {
                userEmail: user.email,
                rolesCount: Object.keys(rolePermissionsData).length
            });

            res.json({ success: true, data: result });
        } catch (error) {
            logger.error('Failed to seed permissions', { error: error.message });
            res.status(500).json({ success: false, error: 'Failed to seed permissions' });
        }
    }

    // Delete a role
    async deleteRole(req, res) {
        try {
            const user = req.user;
            const { role } = req.params;

            if (user.role.toLowerCase() !== 'admin') {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }

            const result = await rolePermissionModel.deleteRole(role);

            if (result.deletedCount === 0) {
                return res.status(404).json({ success: false, error: 'Role not found' });
            }

            logger.info('Permissions: deleteRole', { userEmail: user.email, role });

            res.json({ success: true, data: result });
        } catch (error) {
            logger.error('Failed to delete role', { error: error.message, role: req.params.role });
            res.status(500).json({ success: false, error: 'Failed to delete role' });
        }
    }
}

export const permissionController = new PermissionController();
