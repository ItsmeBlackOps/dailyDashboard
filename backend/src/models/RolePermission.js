import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

export class RolePermissionModel {
    constructor() {
        this.collection = null;
    }

    async initialize() {
        this.collection = database.getCollection('rolePermissions');
        // Create index on role for fast lookups
        await this.collection.createIndex({ role: 1 }, { unique: true });
        logger.info('RolePermissionModel initialized');
    }

    async getAllRoles() {
        try {
            const roles = await this.collection.find({}).toArray();
            return roles;
        } catch (error) {
            logger.error('Failed to get all roles', { error: error.message });
            throw error;
        }
    }

    async getRolePermissions(role) {
        try {
            const normalized = role.toLowerCase().trim();
            const doc = await this.collection.findOne({ role: normalized });
            return doc;
        } catch (error) {
            logger.error('Failed to get role permissions', { error: error.message, role });
            throw error;
        }
    }

    async updateRolePermissions(role, permissions, updatedBy) {
        try {
            const normalized = role.toLowerCase().trim();

            const result = await this.collection.updateOne(
                { role: normalized },
                {
                    $set: {
                        permissions: permissions,
                        updatedAt: new Date(),
                        updatedBy: updatedBy
                    }
                },
                { upsert: true }
            );

            logger.info('Role permissions updated', { role: normalized, permissionCount: permissions.length, updatedBy });

            return result;
        } catch (error) {
            logger.error('Failed to update role permissions', { error: error.message, role });
            throw error;
        }
    }

    async seedRolePermissions(rolePermissionsData, seededBy) {
        try {
            const operations = Object.entries(rolePermissionsData).map(([role, permissions]) => ({
                updateOne: {
                    filter: { role: role.toLowerCase().trim() },
                    update: {
                        $set: {
                            permissions: permissions,
                            updatedAt: new Date(),
                            updatedBy: seededBy,
                            seeded: true
                        }
                    },
                    upsert: true
                }
            }));

            const result = await this.collection.bulkWrite(operations);

            logger.info('Role permissions seeded', {
                rolesCount: Object.keys(rolePermissionsData).length,
                seededBy,
                modified: result.modifiedCount,
                upserted: result.upsertedCount
            });

            return result;
        } catch (error) {
            logger.error('Failed to seed role permissions', { error: error.message });
            throw error;
        }
    }

    async deleteRole(role) {
        try {
            const normalized = role.toLowerCase().trim();
            const result = await this.collection.deleteOne({ role: normalized });

            logger.info('Role permissions deleted', { role: normalized });

            return result;
        } catch (error) {
            logger.error('Failed to delete role', { error: error.message, role });
            throw error;
        }
    }
}

export const rolePermissionModel = new RolePermissionModel();
