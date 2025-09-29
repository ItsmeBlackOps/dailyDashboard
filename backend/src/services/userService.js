import { userModel } from '../models/User.js';
import { refreshTokenModel } from '../models/RefreshToken.js';
import { logger } from '../utils/logger.js';

const ROLE_CANONICAL_MAP = new Map([
  ['admin', 'admin'],
  ['manager', 'manager'],
  ['lead', 'lead'],
  ['user', 'user'],
  ['am', 'AM'],
  ['mm', 'MM'],
  ['mam', 'MAM'],
  ['mlead', 'mlead'],
  ['recruiter', 'recruiter'],
  ['expert', 'expert']
]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class UserService {
  constructor() {
    this.userModel = userModel;
    this.refreshTokenModel = refreshTokenModel;
  }

  async getAllUsers(requestingUserEmail, requestingUserRole) {
    try {
      if (!this.canManageUsers(requestingUserRole)) {
        throw new Error('Insufficient permissions');
      }

      const users = await Promise.resolve(this.userModel.getAllUsers());

      const sanitizedUsers = users.map(user => ({
        email: user.email,
        role: user.role,
        teamLead: user.teamLead,
        manager: user.manager,
        active: user.active !== undefined ? Boolean(user.active) : true,
        _id: user._id
      }));

      logger.info('All users retrieved', {
        requestingUser: requestingUserEmail,
        userCount: sanitizedUsers.length
      });

      return {
        success: true,
        users: sanitizedUsers,
        meta: {
          count: sanitizedUsers.length,
          requestedBy: requestingUserEmail
        }
      };
    } catch (error) {
      logger.error('Failed to get all users', {
        error: error.message,
        requestingUser: requestingUserEmail
      });
      throw error;
    }
  }

  async getUsersByRole(role, requestingUserEmail, requestingUserRole) {
    try {
      if (!this.canViewUsersByRole(requestingUserRole, role)) {
        throw new Error('Insufficient permissions');
      }

      const allUsers = await Promise.resolve(this.userModel.getAllUsers());
      const filteredUsers = allUsers.filter(user => user.role === role);

      const sanitizedUsers = filteredUsers.map(user => ({
        email: user.email,
        role: user.role,
        teamLead: user.teamLead,
        manager: user.manager,
        active: user.active !== undefined ? Boolean(user.active) : true,
        _id: user._id
      }));

      logger.info('Users by role retrieved', {
        requestingUser: requestingUserEmail,
        role,
        userCount: sanitizedUsers.length
      });

      return {
        success: true,
        users: sanitizedUsers,
        meta: {
          count: sanitizedUsers.length,
          role,
          requestedBy: requestingUserEmail
        }
      };
    } catch (error) {
      logger.error('Failed to get users by role', {
        error: error.message,
        requestingUser: requestingUserEmail,
        role
      });
      throw error;
    }
  }

  async getTeamMembers(userEmail, userRole, teamLead) {
    try {
      const teamEmails = await Promise.resolve(
        this.userModel.getTeamEmails(userEmail, userRole, teamLead)
      );

      const teamMembers = (
        await Promise.all(
          teamEmails.map(async email => {
            const user = await Promise.resolve(this.userModel.getUserByEmail(email));
            return user
              ? {
                  email,
                  role: user.role,
                  teamLead: user.teamLead,
                  manager: user.manager,
                  active: user.active !== undefined ? Boolean(user.active) : true
                }
              : null;
          })
        )
      ).filter(Boolean);

      logger.info('Team members retrieved', {
        userEmail,
        teamSize: teamMembers.length
      });

      return {
        success: true,
        teamMembers,
        meta: {
          count: teamMembers.length,
          leadEmail: userEmail,
          userRole
        }
      };
    } catch (error) {
      logger.error('Failed to get team members', {
        error: error.message,
        userEmail,
        userRole
      });
      throw error;
    }
  }

  async updateUserRole(targetEmail, newRole, requestingUserEmail, requestingUserRole) {
    try {
      if (!this.canManageUsers(requestingUserRole)) {
        throw new Error('Insufficient permissions');
      }

      if (!this.isValidRole(newRole)) {
        throw new Error('Invalid role specified');
      }

      const targetUser = await Promise.resolve(this.userModel.getUserByEmail(targetEmail));
      if (!targetUser) {
        throw new Error('Target user not found');
      }

      await this.userModel.updateUser(targetEmail, { role: newRole });

      logger.info('User role updated', {
        targetEmail,
        newRole,
        updatedBy: requestingUserEmail
      });

      return {
        success: true,
        message: 'User role updated successfully',
        targetEmail,
        newRole
      };
    } catch (error) {
      logger.error('Failed to update user role', {
        error: error.message,
        targetEmail,
        newRole,
        requestingUser: requestingUserEmail
      });
      throw error;
    }
  }

  async updateUserTeamLead(targetEmail, newTeamLead, requestingUserEmail, requestingUserRole) {
    try {
      if (!this.canManageUsers(requestingUserRole)) {
        throw new Error('Insufficient permissions');
      }

      const targetUser = await Promise.resolve(this.userModel.getUserByEmail(targetEmail));
      if (!targetUser) {
        throw new Error('Target user not found');
      }

      const formattedTeamLead = this.formatNameValue(newTeamLead);

      await this.userModel.updateUser(targetEmail, { teamLead: formattedTeamLead });

      logger.info('User team lead updated', {
        targetEmail,
        newTeamLead: formattedTeamLead,
        updatedBy: requestingUserEmail
      });

      return {
        success: true,
        message: 'User team lead updated successfully',
        targetEmail,
        newTeamLead: formattedTeamLead
      };
    } catch (error) {
      logger.error('Failed to update user team lead', {
        error: error.message,
        targetEmail,
        newTeamLead,
        requestingUser: requestingUserEmail
      });
      throw error;
    }
  }

  async deleteUser(targetEmail, requestingUserEmail, requestingUserRole) {
    try {
      if (!this.canManageUsers(requestingUserRole)) {
        throw new Error('Insufficient permissions');
      }

      if (targetEmail === requestingUserEmail) {
        throw new Error('Cannot delete your own account');
      }

      const targetUser = await Promise.resolve(this.userModel.getUserByEmail(targetEmail));
      if (!targetUser) {
        throw new Error('Target user not found');
      }

      await this.refreshTokenModel.revokeAllTokensForUser(targetEmail);
      await this.userModel.deleteUser(targetEmail);

      logger.info('User deleted', {
        targetEmail,
        deletedBy: requestingUserEmail
      });

      return {
        success: true,
        message: 'User deleted successfully',
        targetEmail
      };
    } catch (error) {
      logger.error('Failed to delete user', {
        error: error.message,
        targetEmail,
        requestingUser: requestingUserEmail
      });
      throw error;
    }
  }

  async getUserStats(requestingUserEmail, requestingUserRole) {
    try {
      if (!this.canViewStats(requestingUserRole)) {
        throw new Error('Insufficient permissions');
      }

      const allUsers = await Promise.resolve(this.userModel.getAllUsers());

      const roleDistribution = {};
      const teamDistribution = {};

      for (const user of allUsers) {
        roleDistribution[user.role] = (roleDistribution[user.role] || 0) + 1;

        if (user.teamLead) {
          teamDistribution[user.teamLead] = (teamDistribution[user.teamLead] || 0) + 1;
        }
      }

      const stats = {
        totalUsers: allUsers.length,
        roleDistribution,
        teamDistribution,
        activeTeams: Object.keys(teamDistribution).length,
        timestamp: new Date().toISOString()
      };

      logger.info('User stats retrieved', {
        requestingUser: requestingUserEmail,
        totalUsers: stats.totalUsers
      });

      return {
        success: true,
        stats,
        meta: {
          requestedBy: requestingUserEmail,
          requestedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('Failed to get user stats', {
        error: error.message,
        requestingUser: requestingUserEmail
      });
      throw error;
    }
  }

  async searchUsers(searchTerm, requestingUserEmail, requestingUserRole) {
    try {
      if (!this.canSearchUsers(requestingUserRole)) {
        throw new Error('Insufficient permissions');
      }

      const allUsers = await Promise.resolve(this.userModel.getAllUsers());
      const searchLower = searchTerm.toLowerCase();

      const matchedUsers = allUsers.filter(user =>
        user.email.toLowerCase().includes(searchLower) ||
        (user.teamLead && user.teamLead.toLowerCase().includes(searchLower)) ||
        (user.manager && user.manager.toLowerCase().includes(searchLower)) ||
        user.role.toLowerCase().includes(searchLower)
      );

      const sanitizedUsers = matchedUsers.map(user => ({
        email: user.email,
        role: user.role,
        teamLead: user.teamLead,
        manager: user.manager,
        active: user.active !== undefined ? Boolean(user.active) : true,
        _id: user._id
      }));

      logger.info('User search completed', {
        requestingUser: requestingUserEmail,
        searchTerm,
        resultCount: sanitizedUsers.length
      });

      return {
        success: true,
        users: sanitizedUsers,
        meta: {
          count: sanitizedUsers.length,
          searchTerm,
          requestedBy: requestingUserEmail
        }
      };
    } catch (error) {
      logger.error('User search failed', {
        error: error.message,
        requestingUser: requestingUserEmail,
        searchTerm
      });
      throw error;
    }
  }

  canManageUsers(role) {
    return ['admin', 'manager'].includes(role);
  }

  canViewUsersByRole(requestingRole, targetRole) {
    if (requestingRole === 'admin') return true;
    if (requestingRole === 'manager') return true;
    if (requestingRole === 'am' && ['lead', 'user', 'expert'].includes(targetRole)) return true;
    if (requestingRole === 'lead' && ['user', 'expert'].includes(targetRole)) return true;
    return false;
  }

  canViewStats(role) {
    return ['admin', 'manager', 'lead'].includes(role);
  }

  canSearchUsers(role) {
    return ['admin', 'manager', 'lead', 'am'].includes(role);
  }

  isValidRole(role) {
    const validRoles = ['admin', 'lead', 'user', 'AM', 'MM', 'MAM', 'mlead', 'manager', 'expert', 'recruiter'];
    return validRoles.includes(role);
  }

  async getUserProfile(email) {
    try {
      const user = this.userModel.getUserByEmail(email);
      if (!user) {
        throw new Error('User not found');
      }

      return {
        success: true,
        profile: {
          email,
          role: user.role,
          teamLead: user.teamLead,
          manager: user.manager,
          active: user.active !== undefined ? Boolean(user.active) : true
        }
      };
    } catch (error) {
      logger.error('Failed to get user profile', {
        error: error.message,
        email
      });
      throw error;
    }
  }

  async updateUserProfile(email, updateData, requestingUserEmail, requestingUserRole) {
    try {
      const isOwnProfile = email === requestingUserEmail;
      const canManage = this.canManageUsers(requestingUserRole);

      if (!isOwnProfile && !canManage) {
        throw new Error('Insufficient permissions');
      }

      if (updateData.role && !isOwnProfile && !canManage) {
        throw new Error('Cannot change role of other users');
      }

      if (updateData.role && !this.isValidRole(updateData.role)) {
        throw new Error('Invalid role specified');
      }

      const user = this.userModel.getUserByEmail(email);
      if (!user) {
        throw new Error('User not found');
      }

      const sanitizedUpdate = { ...updateData };

      if (sanitizedUpdate.teamLead !== undefined) {
        sanitizedUpdate.teamLead = this.formatNameValue(sanitizedUpdate.teamLead);
      }

      if (sanitizedUpdate.manager !== undefined) {
        sanitizedUpdate.manager = this.formatNameValue(sanitizedUpdate.manager);
      }

      await this.userModel.updateUser(email, sanitizedUpdate);

      logger.info('User profile updated', {
        targetEmail: email,
        updatedBy: requestingUserEmail,
        isOwnProfile
      });

      return {
        success: true,
        message: 'Profile updated successfully',
        profile: {
          email,
          ...sanitizedUpdate
        }
      };
    } catch (error) {
      logger.error('Failed to update user profile', {
        error: error.message,
        targetEmail: email,
        requestingUser: requestingUserEmail
      });
      throw error;
    }
  }

  async updateUserPassword(targetEmail, newPassword, requestingUserEmail, requestingUserRole) {
    const normalizedTargetEmail = (targetEmail || '').trim().toLowerCase();
    const normalizedRequesterEmail = (requestingUserEmail || '').trim().toLowerCase();

    if (!normalizedTargetEmail) {
      const error = new Error('User email is required');
      error.statusCode = 400;
      throw error;
    }

    if (typeof newPassword !== 'string' || !newPassword.trim()) {
      const error = new Error('New password is required');
      error.statusCode = 400;
      throw error;
    }

    const sanitizedPassword = newPassword.trim();
    if (!this.isPasswordStrong(sanitizedPassword)) {
      const error = new Error('Password must be at least 8 characters and include upper, lower case letters and a number');
      error.statusCode = 400;
      throw error;
    }

    const isSelf = normalizedTargetEmail === normalizedRequesterEmail;
    if (!isSelf && !this.canManageUsers(requestingUserRole)) {
      const error = new Error('Insufficient permissions');
      error.statusCode = 403;
      throw error;
    }

    const existing = this.userModel.getUserByEmail(normalizedTargetEmail);
    if (!existing) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    await this.userModel.updateUser(normalizedTargetEmail, { password: sanitizedPassword });
    await this.refreshTokenModel.revokeAllTokensForUser(normalizedTargetEmail);

    logger.info('User password updated', {
      targetEmail: normalizedTargetEmail,
      requestedBy: normalizedRequesterEmail,
      requestedRole: requestingUserRole,
      selfService: isSelf
    });

    return {
      success: true,
      message: 'Password updated successfully'
    };
  }

  normalizeRoleValue(role) {
    if (!role) return null;
    const canonical = ROLE_CANONICAL_MAP.get(role.toString().trim().toLowerCase());
    return canonical || null;
  }

  deriveDisplayNameFromEmail(email) {
    const local = (email || '').split('@')[0];
    const parts = local.split(/[._\s-]+/).filter(Boolean);
    if (parts.length === 0) return email || '';
    return parts
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  normalizeNameValue(value) {
    return (value || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  normalizeEmailValue(value) {
    return (value || '').toString().trim().toLowerCase();
  }

  formatNameValue(value) {
    const raw = value === undefined || value === null ? '' : value.toString();
    const trimmed = raw.trim();

    if (!trimmed) {
      return '';
    }

    if (EMAIL_REGEX.test(trimmed.toLowerCase())) {
      return this.deriveDisplayNameFromEmail(trimmed);
    }

    return trimmed.replace(/\s+/g, ' ');
  }

  isPasswordStrong(value) {
    if (typeof value !== 'string') {
      return false;
    }

    const password = value.trim();
    if (password.length < 8) {
      return false;
    }

    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasDigit = /[0-9]/.test(password);

    return hasUpper && hasLower && hasDigit;
  }

  canInitiateProvisioning(role) {
    const normalized = (role || '').toLowerCase();
    return ['admin', 'manager', 'mm', 'mam', 'mlead', 'lead', 'am'].includes(normalized);
  }

  canCreateRole(requesterRole, targetRole) {
    const requester = (requesterRole || '').toLowerCase();
    const target = (targetRole || '').toLowerCase();

    if (['admin', 'manager'].includes(requester)) return true;
    if (requester === 'mm') return ['mam'].includes(target);
    if (requester === 'mam') return ['mlead', 'recruiter'].includes(target);
    if (requester === 'mlead') return ['recruiter'].includes(target);
    if (requester === 'am') return ['lead', 'user'].includes(target);
    if (requester === 'lead') return ['user'].includes(target);
    return false;
  }

  canManageTargetRole(requesterRole, targetRole) {
    const requester = (requesterRole || '').toLowerCase();
    const target = (targetRole || '').toLowerCase();

    if (['admin', 'manager'].includes(requester)) return true;
    if (requester === 'mm') return ['mam', 'mlead', 'recruiter'].includes(target);
    if (requester === 'mam') return ['mlead', 'recruiter'].includes(target);
    if (requester === 'mlead') return ['recruiter'].includes(target);
    if (requester === 'am') return ['lead', 'user'].includes(target);
    if (requester === 'lead') return ['user'].includes(target);
    return false;
  }

  resolveTeamLeadForCreation(requestingUser, targetRole, providedTeamLead = '', targetEmail = '') {
    const formattedProvided = this.formatNameValue(providedTeamLead);
    if (formattedProvided) {
      return formattedProvided;
    }

    const requesterRole = (requestingUser.role || '').toLowerCase();
    const requesterDisplayName = this.deriveDisplayNameFromEmail(requestingUser.email);
    const normalizedTarget = (targetRole || '').toLowerCase();
    const targetDisplayName = this.formatNameValue(this.deriveDisplayNameFromEmail(targetEmail));

    if (normalizedTarget === 'mlead') {
      return targetDisplayName || requesterDisplayName;
    }

    if (normalizedTarget === 'recruiter') {
      if (['mlead', 'mam', 'mm'].includes(requesterRole)) {
        return requesterDisplayName;
      }
      return targetDisplayName;
    }

    if (normalizedTarget === 'lead' && requesterRole === 'am') {
      return requesterDisplayName;
    }

    if (normalizedTarget === 'user' && requesterRole === 'lead') {
      return requesterDisplayName;
    }

    return '';
  }

  resolveManagerForCreation(requestingUser, targetRole, providedManager = '', requesterRecord = null, targetEmail = '') {
    const formattedProvided = this.formatNameValue(providedManager);
    if (formattedProvided) {
      return formattedProvided;
    }

    const normalizedTarget = (targetRole || '').toLowerCase();
    if (normalizedTarget === 'mlead') {
      const targetDisplayName = this.formatNameValue(this.deriveDisplayNameFromEmail(targetEmail));
      if (targetDisplayName) {
        return targetDisplayName;
      }
    }

    const requesterRole = (requestingUser.role || '').toLowerCase();
    if (requesterRole === 'mm') {
      return this.deriveDisplayNameFromEmail(requestingUser.email);
    }

     if (requesterRole === 'am') {
       const requesterManagerDisplay = this.formatNameValue(requesterRecord?.manager ?? '');
       if (requesterManagerDisplay) {
         return requesterManagerDisplay;
       }
     }

    const requesterManager = this.formatNameValue(requesterRecord?.manager ?? '');
    if (requesterManager) {
      return requesterManager;
    }

    return this.deriveDisplayNameFromEmail(requestingUser.email);
  }

  sanitizeEmail(value) {
    const email = (value || '').toString().trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      throw new Error('Invalid email format');
    }
    return email;
  }

  collectManageableUsers(requestingUser) {
    const allUsers = this.userModel.getAllUsers();

    // Admins can manage everyone. Return all except self.
    const requesterRole = (requestingUser.role || '').toLowerCase();
    if (['admin'].includes(requesterRole)) {
      const selfEmail = this.normalizeEmailValue(requestingUser.email);
      return allUsers
        .filter((u) => this.normalizeEmailValue(u.email) !== selfEmail)
        .map((user) => ({
          email: user.email,
          role: user.role,
          teamLead: user.teamLead,
          manager: user.manager,
          active: user.active !== undefined ? Boolean(user.active) : true
        }));
    }

    const teamLeadMap = new Map();
    const managerMap = new Map();

    for (const user of allUsers) {
      if (user.teamLead) {
        const key = this.normalizeNameValue(user.teamLead);
        if (!teamLeadMap.has(key)) {
          teamLeadMap.set(key, []);
        }
        teamLeadMap.get(key).push(user);
      }

      if (user.manager) {
        const key = this.normalizeNameValue(user.manager);
        if (!managerMap.has(key)) {
          managerMap.set(key, []);
        }
        managerMap.get(key).push(user);
      }
    }

    const requesterDisplay = this.normalizeNameValue(this.deriveDisplayNameFromEmail(requestingUser.email));
    // requesterRole already derived above for early return; keep local reference for remaining roles

    const queue = [];
    const visited = new Set();

    const pushReports = (users = []) => {
      for (const user of users) {
        if (user && user.email) {
          queue.push(user);
        }
      }
    };

    if (requesterRole === 'mm') {
      pushReports(managerMap.get(requesterDisplay) || []);
    }

    pushReports(teamLeadMap.get(requesterDisplay) || []);

    const manageable = [];

    while (queue.length > 0) {
      const user = queue.shift();
      const email = this.normalizeEmailValue(user.email);

      if (!email || visited.has(email) || email === this.normalizeEmailValue(requestingUser.email)) {
        continue;
      }

      visited.add(email);

      if (this.canManageTargetRole(requestingUser.role, user.role)) {
        manageable.push({
          email,
          role: user.role,
          teamLead: user.teamLead,
          manager: user.manager,
          active: user.active !== undefined ? Boolean(user.active) : true
        });
      }

      const userDisplay = this.normalizeNameValue(this.deriveDisplayNameFromEmail(user.email));
      pushReports(teamLeadMap.get(userDisplay) || []);
    }

    return manageable;
  }

  async getManageableUsers(requestingUser) {
    if (!this.canInitiateProvisioning(requestingUser.role)) {
      throw new Error('Insufficient permissions');
    }

    const users = this.collectManageableUsers(requestingUser);

    return {
      success: true,
      users,
      meta: {
        count: users.length,
        requestedBy: requestingUser.email
      }
    };
  }

  async bulkCreateUsers(requestingUser, payload = []) {
    if (!this.canInitiateProvisioning(requestingUser.role)) {
      throw new Error('Insufficient permissions');
    }

    if (!Array.isArray(payload) || payload.length === 0) {
      throw new Error('At least one user entry is required');
    }

    if (payload.length > 50) {
      throw new Error('Cannot create more than 50 users at once');
    }

    const requesterRecord = this.userModel.getUserByEmail(requestingUser.email) || null;

    const created = [];
    const failures = [];
    const seenEmails = new Set();

    for (let index = 0; index < payload.length; index += 1) {
      const entry = payload[index] || {};

      try {
        const email = this.sanitizeEmail(entry.email);

        if (seenEmails.has(email)) {
          throw new Error('Duplicate email in payload');
        }

        if (this.userModel.getUserByEmail(email)) {
          throw new Error('User already exists');
        }

        const canonicalRole = this.normalizeRoleValue(entry.role);
        if (!canonicalRole) {
          throw new Error('Unsupported role');
        }

        if (!this.canCreateRole(requestingUser.role, canonicalRole)) {
          throw new Error('Not allowed to create this role');
        }

        if (typeof entry.password !== 'string' || entry.password.length < 6) {
          throw new Error('Password must be at least 6 characters long');
        }

        const teamLead = this.resolveTeamLeadForCreation(requestingUser, canonicalRole, entry.teamLead, email);
        const manager = this.resolveManagerForCreation(requestingUser, canonicalRole, entry.manager, requesterRecord, email);
        const active = entry.active !== undefined ? Boolean(entry.active) : true;

        await this.userModel.createUser({
          email,
          password: entry.password,
          role: canonicalRole,
          teamLead,
          manager,
          active
        });

        logger.info('Bulk user creation completed', {
          createdBy: requestingUser.email,
          email,
          role: canonicalRole
        });

        created.push({ email, role: canonicalRole, teamLead, manager, active });
        seenEmails.add(email);
      } catch (error) {
        failures.push({
          index,
          email: entry.email || null,
          error: error.message
        });
      }
    }

    return {
      success: failures.length === 0,
      created,
      failures
    };
  }

  async bulkUpdateUsers(requestingUser, payload = []) {
    if (!this.canInitiateProvisioning(requestingUser.role)) {
      throw new Error('Insufficient permissions');
    }

    if (!Array.isArray(payload) || payload.length === 0) {
      throw new Error('At least one user entry is required');
    }

    if (payload.length > 100) {
      throw new Error('Cannot update more than 100 users at once');
    }

    const updates = [];
    const failures = [];

    for (let index = 0; index < payload.length; index += 1) {
      const entry = payload[index] || {};

      try {
        const email = this.sanitizeEmail(entry.email);
        const targetUser = this.userModel.getUserByEmail(email);

        if (!targetUser) {
          throw new Error('User not found');
        }

        if (!this.canManageTargetRole(requestingUser.role, targetUser.role)) {
          throw new Error('Not allowed to manage this user');
        }

        const updatePayload = {};
        let revokeTokens = false;
        let resultingRole = targetUser.role;
        let roleChangedToMlead = false;
        const derivedSelfName = this.formatNameValue(this.deriveDisplayNameFromEmail(email));

        const requesterNormalized = (requestingUser.role || '').toLowerCase();
        const requesterDisplayName = this.formatNameValue(this.deriveDisplayNameFromEmail(requestingUser.email));
        const targetRoleLower = (targetUser.role || '').toLowerCase();

        if (entry.role !== undefined) {
          const canonicalRole = this.normalizeRoleValue(entry.role);
          if (!canonicalRole) {
            throw new Error('Unsupported role');
          }

          const canonicalRoleLower = (canonicalRole || '').toLowerCase();
          const allowedMmRoles = ['mam', 'mlead', 'recruiter'];
          const canOverrideRoleChange = requesterNormalized === 'mm'
            && allowedMmRoles.includes(targetRoleLower)
            && allowedMmRoles.includes(canonicalRoleLower);
          const canLeadAssign = requesterNormalized === 'lead'
            && targetRoleLower === 'user'
            && canonicalRoleLower === 'user';

          if (canonicalRole !== targetUser.role && !this.canCreateRole(requestingUser.role, canonicalRole) && !canOverrideRoleChange && !canLeadAssign) {
            throw new Error('Not allowed to assign this role');
          }

          updatePayload.role = canonicalRole;
          resultingRole = canonicalRole;
          if ((canonicalRole || '').toLowerCase() === 'mlead' && canonicalRole !== targetUser.role) {
            roleChangedToMlead = true;
          }
          revokeTokens = true;
        }

        const resultingRoleLower = (resultingRole || '').toLowerCase();

        if (entry.teamLead !== undefined) {
          const rawTeamLead = typeof entry.teamLead === 'string' ? entry.teamLead : targetUser.teamLead;
          const formattedTeamLead = this.formatNameValue(rawTeamLead);
          if (formattedTeamLead) {
            updatePayload.teamLead = formattedTeamLead;
          } else if (resultingRoleLower === 'mlead' && derivedSelfName) {
            updatePayload.teamLead = derivedSelfName;
          }
        } else if (roleChangedToMlead && derivedSelfName) {
          updatePayload.teamLead = derivedSelfName;
        }

        if (entry.manager !== undefined) {
          const rawManager = typeof entry.manager === 'string' ? entry.manager : targetUser.manager;
          const formattedManager = this.formatNameValue(rawManager);
          if (formattedManager) {
            updatePayload.manager = formattedManager;
          } else if (resultingRoleLower === 'mlead' && derivedSelfName) {
            updatePayload.manager = derivedSelfName;
          }
        } else if (roleChangedToMlead && derivedSelfName) {
          updatePayload.manager = derivedSelfName;
        }

        if (requesterNormalized === 'mm' && ['mam', 'mlead', 'recruiter'].includes(targetRoleLower)) {
          if (targetRoleLower === 'mam') {
            delete updatePayload.teamLead;
          }

          if (!updatePayload.manager || updatePayload.manager.trim() === '') {
            if (requesterDisplayName) {
              updatePayload.manager = requesterDisplayName;
            }
          }

          if ((targetRoleLower === 'mlead' || targetRoleLower === 'recruiter') && !updatePayload.teamLead) {
            const existingLead = this.formatNameValue(targetUser.teamLead ?? '');
            if (existingLead) {
              updatePayload.teamLead = existingLead;
            }
          }
        }

        if (requesterNormalized === 'lead' && targetRoleLower === 'user') {
          if (!updatePayload.teamLead || updatePayload.teamLead.trim() === '') {
            updatePayload.teamLead = requesterDisplayName;
          }

          if (!updatePayload.manager || updatePayload.manager.trim() === '') {
            const requesterManager = this.formatNameValue(this.userModel.getUserByEmail(requestingUser.email)?.manager ?? '');
            updatePayload.manager = requesterManager || requesterDisplayName;
          }
        }

        if (entry.active !== undefined) {
          updatePayload.active = Boolean(entry.active);
          if (updatePayload.active === false) {
            revokeTokens = true;
          }
        }

        if (entry.password !== undefined) {
          if (typeof entry.password !== 'string' || entry.password.length < 6) {
            throw new Error('Password must be at least 6 characters long');
          }
          updatePayload.password = entry.password;
          revokeTokens = true;
        }

        if (Object.keys(updatePayload).length === 0) {
          throw new Error('No changes provided for this user');
        }

        await this.userModel.updateUser(email, updatePayload);

        if (revokeTokens) {
          await this.refreshTokenModel.revokeAllTokensForUser(email);
        }

        logger.info('Bulk user update applied', {
          updatedBy: requestingUser.email,
          email,
          changes: Object.keys(updatePayload)
        });

        updates.push({
          email,
          appliedChanges: Object.keys(updatePayload)
        });
      } catch (error) {
        failures.push({
          index,
          email: entry.email || null,
          error: error.message
        });
      }
    }

    return {
      success: failures.length === 0,
      updates,
      failures
    };
  }
}

export const userService = new UserService();
