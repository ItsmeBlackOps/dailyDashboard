import { roleModel } from '../models/Role.js';
import { logger } from '../utils/logger.js';

export const roleController = {
    /**
     * Get all roles and their configurations
     */
    async getAllRoles(req, res) {
        try {
            const roles = roleModel.getAllRoles();
            return res.status(200).json({
                success: true,
                roles
            });
        } catch (error) {
            logger.error('Failed to get roles', { error: error.message });
            return res.status(500).json({
                success: false,
                error: 'Failed to retrieve roles'
            });
        }
    },

    /**
     * Update a specific role's permissions and scopes
     */
    async updateRole(req, res) {
        const { role } = req.params;
        const { permissions, scopes } = req.body;

        if (!role) {
            return res.status(400).json({ success: false, error: 'Role name is required' });
        }

        try {
            const existingRole = roleModel.getRole(role);
            if (!existingRole) {
                return res.status(404).json({ success: false, error: 'Role not found' });
            }

            await roleModel.updateRole(role, { permissions, scopes });

            logger.info('Role updated', {
                admin: req.user.email,
                targetRole: role,
                updatedPermissions: permissions?.length
            });

            return res.status(200).json({
                success: true,
                message: 'Role updated successfully',
                role: roleModel.getRole(role)
            });

        } catch (error) {
            logger.error('Failed to update role', { error: error.message, role });
            return res.status(500).json({
                success: false,
                error: 'Failed to update role'
            });
        }
    }
};
