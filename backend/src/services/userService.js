import { userModel } from '../models/User.js';
import { refreshTokenModel } from '../models/RefreshToken.js';
import { logger } from '../utils/logger.js';

// Canonical role enum (lowercase). Drops legacy 'manager' and 'expert' —
// 'manager' had zero users in DB and was effectively dead permission tier;
// its capabilities are now expressed as 'mm' (branch manager) where
// appropriate. 'expert' is kept as a logical TYPE in tag/notification
// code but is no longer a stored user role. 'AM/MM/MAM' uppercase
// variants normalized to lowercase to match storage.
// C20 Phase 1 — dual-read: accept both legacy and new role names. The map
// is keyed by either form and resolves to a single canonical lowercase
// stored value. New names map to themselves; legacy names also map to
// themselves for now (no auto-rename on read; the migration already
// rewrote DB rows). Frontend writes new names. Old-name writes from
// stragglers are still accepted and logged via emitLegacyRoleWarning().
const ROLE_CANONICAL_MAP = new Map([
  // legacy names (still accepted during the dual-read window)
  ['admin',           'admin'],
  ['lead',            'lead'],
  ['user',            'user'],
  ['am',              'am'],
  ['mm',              'mm'],
  ['mam',             'mam'],
  ['mlead',           'mlead'],
  ['recruiter',       'recruiter'],
  // new names introduced in C20
  ['manager',          'manager'],
  ['assistantmanager', 'assistantManager'],
  ['teamlead',         'teamLead'],
  ['expert',           'expert'],
]);

// Legacy names — used by emitLegacyRoleWarning to flag any straggler
// writes after the migration. Removed when the dual-read window closes.
const LEGACY_ROLE_NAMES = new Set(['lead', 'user', 'am', 'mm', 'mam', 'mlead']);

// Valid teams. `null` is reserved for admin only.
const VALID_TEAMS = new Set(['technical', 'marketing', 'sales']);

const VALID_ROLES = new Set(ROLE_CANONICAL_MAP.values());

// C20 — Role "level" abstraction. Both legacy and new role names map to
// the same level token, so permission checks can compare on level
// regardless of which name is stored. Old `am` (technical AM) and `mam`
// (marketing AM) collapse to the same level: assistantManager.
const ROLE_LEVEL = new Map([
  ['admin',            'admin'],
  ['mm',               'manager'],
  ['manager',          'manager'],
  ['am',               'assistantManager'],
  ['mam',              'assistantManager'],
  ['assistantmanager', 'assistantManager'],
  ['lead',             'teamLead'],
  ['mlead',            'teamLead'],
  ['teamlead',         'teamLead'],
  ['recruiter',        'recruiter'],
  ['user',             'expert'],
  ['expert',           'expert'],
]);

const roleLevel = (role) => ROLE_LEVEL.get((role || '').toLowerCase().trim()) || null;

// Pre-built superset arrays — extend the existing permission gates so
// they accept both legacy and new role names. Removing the legacy entries
// is the final step when the dual-read window closes.
const ROLES_ADMIN_OR_MANAGER       = ['admin', 'mm', 'manager'];
const ROLES_ADMIN_MANAGER_TEAMLEAD = ['admin', 'mm', 'manager', 'lead', 'teamLead'];
const ROLES_ADMIN_MANAGER_TL_AM    = ['admin', 'mm', 'manager', 'lead', 'teamLead', 'am', 'assistantManager'];
const ROLES_PROVISIONERS           = ['admin', 'mm', 'manager', 'mam', 'assistantManager', 'mlead', 'teamLead', 'lead', 'am'];
const ROLES_MM_SUBORDINATES        = ['mam', 'assistantManager', 'mlead', 'teamLead', 'recruiter'];

// Track legacy-name writes — emits a structured warn so we can spot
// stragglers (e.g. an old client still posting `role: "mm"`) during the
// dual-read window. Keep this until we drop the legacy aliases.
const emitLegacyRoleWarning = (role, source) => {
  if (LEGACY_ROLE_NAMES.has((role || '').toLowerCase().trim())) {
    logger.warn('legacy role name in write path', { role, source });
  }
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
        team: user.team || null,
        acceptsTasks: user.acceptsTasks !== undefined ? Boolean(user.acceptsTasks) : false,
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
      const targetRole = (role || '').toLowerCase();
      const filteredUsers = allUsers.filter(user => (user.role || '').toLowerCase() === targetRole);

      const sanitizedUsers = filteredUsers.map(user => ({
        email: user.email,
        role: user.role,
        team: user.team || null,
        acceptsTasks: user.acceptsTasks !== undefined ? Boolean(user.acceptsTasks) : false,
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
                  team: user.team || null,
        acceptsTasks: user.acceptsTasks !== undefined ? Boolean(user.acceptsTasks) : false,
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

      const normalizedNewRole = (newRole || '').toLowerCase().trim();
      await this.userModel.updateUser(targetEmail, {
        role: normalizedNewRole,
        _changedBy: requestingUserEmail,
        _source: 'manual-ui',
      });

      logger.info('User role updated', {
        targetEmail,
        newRole: normalizedNewRole,
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

      // C9/C15: validate against the existing role on disk before writing.
      const check = this.validateTeamLeadCompatibility(targetUser.role, formattedTeamLead);
      if (!check.valid) {
        throw new Error(`Invalid role/teamLead combination: ${check.reason}`);
      }

      await this.userModel.updateUser(targetEmail, {
        teamLead: formattedTeamLead,
        _changedBy: requestingUserEmail,
        _source: 'manual-ui',
      });

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
        team: user.team || null,
        acceptsTasks: user.acceptsTasks !== undefined ? Boolean(user.acceptsTasks) : false,
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
    return ROLES_ADMIN_OR_MANAGER.includes((role || '').toLowerCase());
  }

  canViewUsersByRole(requestingRole, targetRole) {
    // C20 — compare on level tokens so legacy + new names are accepted.
    const r = roleLevel(requestingRole);
    const t = roleLevel(targetRole);
    if (r === 'admin') return true;
    if (r === 'manager') return true;
    if (r === 'assistantManager' && ['teamLead', 'expert', 'recruiter'].includes(t)) return true;
    if (r === 'teamLead' && ['expert', 'recruiter'].includes(t)) return true;
    return false;
  }

  canViewStats(role) {
    return ROLES_ADMIN_MANAGER_TEAMLEAD.includes((role || '').toLowerCase());
  }

  canSearchUsers(role) {
    return ROLES_ADMIN_MANAGER_TL_AM.includes((role || '').toLowerCase());
  }

  // Case-insensitive — accepts any casing the caller hands in (UI / route
  // params / legacy data) and validates against the canonical lowercase set.
  isValidRole(role) {
    if (!role) return false;
    return VALID_ROLES.has(role.toString().toLowerCase().trim());
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
          team: user.team || null,
        acceptsTasks: user.acceptsTasks !== undefined ? Boolean(user.acceptsTasks) : false,
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

  // C8: BFS through teamLead chain to determine whether `targetEmail` is
  // a subordinate (direct or transitive) of `requester`. Mirrors the
  // logic in candidateService.collectHierarchyEmails but lives here to
  // avoid a circular import.
  //
  // Match is by display name (today). Once C9 lands, this becomes a
  // straight email-keyed BFS — but the public signature stays the same.
  // C19 phase 2 — async + delegation-aware. The original BFS walks the
  // teamLead chain. After phase 2, we ALSO union in any active
  // delegations where `requester` is the delegate. A `subtree` share
  // expands to a BFS rooted at the share's subtreeRootEmail; a
  // `specific` share contributes its subjectEmails directly.
  //
  // Caller is expected to await — was sync, now async. Only one
  // production caller (controllers/userController._canReadProfile),
  // updated alongside this change.
  async isUserInRequesterHierarchy(requester, targetEmail) {
    if (!requester?.email || !targetEmail) return false;
    const target = (targetEmail || '').toString().toLowerCase().trim();
    const requesterEmail = (requester.email || '').toString().toLowerCase().trim();
    if (target === requesterEmail) return true;

    const allUsers = this.userModel.getAllUsers();

    // Pre-build the leadDisplayName → [reports] map once; reused by
    // both the requester's own BFS and any subtree-scoped delegations.
    const leadToUsers = new Map();
    for (const u of allUsers) {
      if (!u.teamLead) continue;
      const k = this.normalizeNameValue(u.teamLead);
      if (!leadToUsers.has(k)) leadToUsers.set(k, []);
      leadToUsers.get(k).push(u);
    }

    const bfsContains = (rootDisplayName) => {
      if (!rootDisplayName) return false;
      const visited = new Set();
      const queue = [rootDisplayName];
      while (queue.length > 0) {
        const cur = queue.shift();
        if (!cur || visited.has(cur)) continue;
        visited.add(cur);
        const directs = leadToUsers.get(cur) || [];
        for (const r of directs) {
          const rEmail = (r.email || '').toLowerCase().trim();
          if (rEmail === target) return true;
          const rDisplay = this.normalizeNameValue(this.deriveDisplayNameFromEmail(r.email));
          if (rDisplay && !visited.has(rDisplay)) queue.push(rDisplay);
        }
      }
      return false;
    };

    // 1. Requester's own subtree.
    const ownRoot = this.normalizeNameValue(this.deriveDisplayNameFromEmail(requesterEmail));
    if (bfsContains(ownRoot)) return true;

    // 2. Active delegations TO this requester. Lazy import to avoid a
    //    circular dep at module load (delegationService imports userModel).
    try {
      const { delegationService } = await import('./delegationService.js');
      const delegations = await delegationService.listActiveForUser(requesterEmail);
      for (const d of delegations) {
        if (d.scope === 'specific') {
          const hit = (d.subjectEmails || []).some((e) => (e || '').toLowerCase().trim() === target);
          if (hit) return true;
        } else if (d.scope === 'subtree') {
          const root = (d.subtreeRootEmail || '').toLowerCase().trim();
          if (root === target) return true;
          const rootDisplay = this.normalizeNameValue(this.deriveDisplayNameFromEmail(root));
          if (bfsContains(rootDisplay)) return true;
        }
      }
    } catch (err) {
      // If delegationService fails, fall back to the own-subtree result.
      // Logged so an outage is visible but doesn't 500 the whole BFS.
      logger.warn('isUserInRequesterHierarchy: delegation lookup failed', {
        error: err.message, requester: requesterEmail,
      });
    }

    return false;
  }

  // C9/C15: role/teamLead compatibility validator.
  //   Returns the role(s) currently held by users whose displayName matches
  //   `name` (after normalization). Multiple roles signal a name collision
  //   (D3) — caller can decide whether to accept any-match or reject.
  _getRolesForDisplayName(name) {
    const norm = this.normalizeNameValue(name);
    if (!norm) return [];
    const matches = this.userModel.getAllUsers().filter(u => {
      const d = this.normalizeNameValue(this.deriveDisplayNameFromEmail(u.email));
      return d && d === norm;
    });
    return [...new Set(matches.map(u => (u.role || '').toLowerCase()).filter(Boolean))];
  }

  //   Hierarchy contract (C20 — level-based, accepts legacy + new names):
  //     assistantManager → manager, admin
  //     teamLead         → assistantManager, manager, admin
  //     recruiter        → teamLead, assistantManager, manager, admin
  //     expert           → teamLead, assistantManager, manager, admin
  //     admin / manager  → no teamLead required (any value tolerated)
  validateTeamLeadCompatibility(role, teamLeadName) {
    const lvl = roleLevel(role);
    const formatted = this.formatNameValue(teamLeadName);
    if (!lvl) return { valid: true };
    if (['admin', 'manager'].includes(lvl)) return { valid: true };
    if (!formatted) return { valid: true };

    const allowed = {
      assistantManager: ['manager', 'admin'],
      teamLead:         ['assistantManager', 'manager', 'admin'],
      recruiter:        ['teamLead', 'assistantManager', 'manager', 'admin'],
      expert:           ['teamLead', 'assistantManager', 'manager', 'admin'],
    }[lvl];

    if (!allowed) return { valid: true };

    const candidateLevels = this._getRolesForDisplayName(formatted)
      .map(r => roleLevel(r))
      .filter(Boolean);

    if (candidateLevels.length === 0) {
      return {
        valid: false,
        reason: `teamLead "${formatted}" does not match any active user`
      };
    }
    const ok = candidateLevels.some(r => allowed.includes(r));
    if (!ok) {
      return {
        valid: false,
        reason: `${lvl} requires teamLead at level [${allowed.join(', ')}]; "${formatted}" is at level [${[...new Set(candidateLevels)].join(', ')}]`
      };
    }
    return { valid: true };
  }

  // C20 — resolve `team` for a new user. Admins are team-less. Phase 1
  // is additive: explicit valid team wins, else inherit from requester,
  // else null. We never throw on missing team during the dual-read
  // window because legacy callers don't know about the field. Phase 2
  // will tighten when sales arrives.
  _resolveTeamForCreation(role, providedTeam, requesterRecord) {
    if (roleLevel(role) === 'admin') return null;
    const provided = (providedTeam || '').toString().toLowerCase().trim();
    if (provided) {
      if (!VALID_TEAMS.has(provided)) {
        throw new Error(`Invalid team "${provided}" — must be one of: ${[...VALID_TEAMS].join(', ')}`);
      }
      return provided;
    }
    const inherited = (requesterRecord?.team || '').toString().toLowerCase().trim();
    if (inherited && VALID_TEAMS.has(inherited)) return inherited;
    return null;
  }

  // C17: read change history (role / teamLead / manager / active mutations).
  async getUserChangeHistory(email) {
    try {
      const lc = (email || '').toLowerCase();
      const doc = await this.userModel.findUserDocumentByEmailCaseInsensitive(lc, {
        email: 1, changeHistory: 1,
      });
      if (!doc) throw new Error('User not found');
      const entries = (Array.isArray(doc.changeHistory) ? doc.changeHistory : [])
        .map((e) => ({
          field:     e.field,
          from:      e.from ?? null,
          to:        e.to ?? null,
          changedAt: e.changedAt instanceof Date ? e.changedAt.toISOString() : e.changedAt,
          changedBy: e.changedBy || 'system',
          source:    e.source || null,
          reason:    e.reason || null,
        }))
        .sort((a, b) => new Date(a.changedAt || 0) - new Date(b.changedAt || 0));
      return { success: true, email: doc.email || lc, history: entries };
    } catch (error) {
      logger.error('Failed to get user change history', { error: error.message, email });
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

      // C20 — validate team if provided; only admin may have null team.
      if (sanitizedUpdate.team !== undefined && sanitizedUpdate.team !== null) {
        const t = (sanitizedUpdate.team || '').toString().toLowerCase().trim();
        if (!VALID_TEAMS.has(t)) {
          throw new Error(`Invalid team "${t}"`);
        }
        sanitizedUpdate.team = t;
      }
      if (sanitizedUpdate.role !== undefined) {
        emitLegacyRoleWarning(sanitizedUpdate.role, 'updateUserProfile');
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
    return ROLES_PROVISIONERS.includes(normalized);
  }

  // C20 — accept both legacy and new role names but preserve the original
  // technical/marketing split via the legacy name pairings. New names map
  // forward by team (after migration the team field carries the split):
  //   manager           ≡ mm   (cross-team during dual-read; team enforced in Phase 2)
  //   assistantManager  ≡ mam  (marketing) OR am (technical) depending on team
  //   teamLead          ≡ mlead (marketing) OR lead (technical) depending on team
  //   expert            ≡ user
  canCreateRole(requesterRole, targetRole) {
    const requester = (requesterRole || '').toLowerCase();
    const target = (targetRole || '').toLowerCase();

    if (requester === 'admin') return true;
    if (requester === 'mm' || requester === 'manager') {
      return ['mam', 'mlead', 'recruiter', 'assistantmanager', 'teamlead'].includes(target);
    }
    if (requester === 'mam' || requester === 'assistantmanager') {
      return ['mlead', 'recruiter', 'teamlead'].includes(target);
    }
    if (requester === 'mlead') return ['recruiter'].includes(target);
    if (requester === 'am') return ['lead', 'user', 'expert'].includes(target);
    if (requester === 'lead') return ['user', 'expert'].includes(target);
    // New `teamLead` accepts the union during dual-read because the
    // requester's home team is what disambiguates — Phase 2 reads team.
    if (requester === 'teamlead') {
      return ['recruiter', 'user', 'expert'].includes(target);
    }
    return false;
  }

  canManageTargetRole(requesterRole, targetRole) {
    return this.canCreateRole(requesterRole, targetRole);
  }

  resolveTeamLeadForCreation(requestingUser, targetRole, providedTeamLead = '', targetEmail = '') {
    const formattedProvided = this.formatNameValue(providedTeamLead);
    if (formattedProvided) {
      return formattedProvided;
    }

    // C20 — level-based comparison so legacy + new role names work.
    const requesterLvl = roleLevel(requestingUser.role);
    const targetLvl = roleLevel(targetRole);
    const requesterDisplayName = this.deriveDisplayNameFromEmail(requestingUser.email);
    const targetDisplayName = this.formatNameValue(this.deriveDisplayNameFromEmail(targetEmail));

    if (targetLvl === 'teamLead') {
      return targetDisplayName || requesterDisplayName;
    }

    if (targetLvl === 'recruiter') {
      if (['teamLead', 'assistantManager', 'manager'].includes(requesterLvl)) {
        return requesterDisplayName;
      }
      return targetDisplayName;
    }

    if (targetLvl === 'expert') {
      if (['teamLead', 'assistantManager', 'manager'].includes(requesterLvl)) {
        return requesterDisplayName;
      }
      return targetDisplayName;
    }

    return '';
  }

  resolveManagerForCreation(requestingUser, targetRole, providedManager = '', requesterRecord = null, targetEmail = '') {
    const formattedProvided = this.formatNameValue(providedManager);
    if (formattedProvided) {
      return formattedProvided;
    }

    // C20 — level-based comparison.
    const targetLvl = roleLevel(targetRole);
    if (targetLvl === 'teamLead') {
      const targetDisplayName = this.formatNameValue(this.deriveDisplayNameFromEmail(targetEmail));
      if (targetDisplayName) {
        return targetDisplayName;
      }
    }

    const requesterLvl = roleLevel(requestingUser.role);
    if (requesterLvl === 'manager') {
      return this.deriveDisplayNameFromEmail(requestingUser.email);
    }

    if (requesterLvl === 'assistantManager') {
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

  buildTaskHierarchyScope(requestingUser = {}) {
    const selfEmail = this.normalizeEmailValue(requestingUser.email);
    const manageableUsers = this.collectManageableUsers(requestingUser);

    const emailSet = new Set();
    if (selfEmail) {
      emailSet.add(selfEmail);
    }

    for (const user of manageableUsers) {
      const normalizedEmail = this.normalizeEmailValue(user?.email);
      if (normalizedEmail) {
        emailSet.add(normalizedEmail);
      }
    }

    const emails = Array.from(emailSet).sort();
    const locals = Array.from(
      new Set(
        emails
          .map((email) => email.split('@')[0])
          .map((value) => this.normalizeNameValue(value))
          .filter(Boolean)
      )
    );

    const displayNames = Array.from(
      new Set(
        emails
          .map((email) => this.deriveDisplayNameFromEmail(email))
          .map((value) => this.normalizeNameValue(value))
          .filter(Boolean)
      )
    );

    const escaped = {
      emails: emails.map((value) => escapeRegex(value)),
      locals: locals.map((value) => escapeRegex(value)),
      displayNames: displayNames.map((value) => escapeRegex(value))
    };

    return {
      emails,
      locals,
      displayNames,
      escaped
    };
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
          team: user.team || null,
        acceptsTasks: user.acceptsTasks !== undefined ? Boolean(user.acceptsTasks) : false,
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

    if (roleLevel(requesterRole) === 'manager') {
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
          team: user.team || null,
        acceptsTasks: user.acceptsTasks !== undefined ? Boolean(user.acceptsTasks) : false,
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
    const adminHash = requesterRecord?.passwordHash || null;

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

        // C20 — resolve team. Admins have no team. Otherwise: explicit
        // value if provided + valid; else inherit from requester; else
        // throw (don't silently misclassify).
        const team = this._resolveTeamForCreation(canonicalRole, entry.team, requesterRecord);

        // C9/C15: reject creates that would land in an invalid (role,
        // teamLead) state — e.g. a recruiter pointing at another recruiter.
        {
          const check = this.validateTeamLeadCompatibility(canonicalRole, teamLead);
          if (!check.valid) {
            throw new Error(`Invalid role/teamLead combination: ${check.reason}`);
          }
        }

        emitLegacyRoleWarning(canonicalRole, 'bulkCreateUsers');
        await this.userModel.createUser({
          email,
          password: entry.password,
          adminHash,
          role: canonicalRole,
          team,
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

          // C20 — accept legacy + new override allowances side-by-side.
          // A manager (mm/manager) can move anyone in the marketing
          // subordinate set; a teamLead/lead can promote experts/users.
          const canonicalRoleLower = (canonicalRole || '').toLowerCase();
          const allowedMmRoles = ['mam', 'mlead', 'recruiter', 'assistantmanager', 'teamlead'];
          const canOverrideRoleChange =
            (requesterNormalized === 'mm' || requesterNormalized === 'manager')
            && allowedMmRoles.includes(targetRoleLower)
            && allowedMmRoles.includes(canonicalRoleLower);
          const canLeadAssign =
            (requesterNormalized === 'lead' || requesterNormalized === 'teamlead')
            && (targetRoleLower === 'user' || targetRoleLower === 'expert')
            && (canonicalRoleLower === 'user' || canonicalRoleLower === 'expert');

          if (canonicalRole !== targetUser.role && !this.canCreateRole(requestingUser.role, canonicalRole) && !canOverrideRoleChange && !canLeadAssign) {
            throw new Error('Not allowed to assign this role');
          }

          emitLegacyRoleWarning(canonicalRole, 'bulkUpdateUsers');
          updatePayload.role = canonicalRole;
          resultingRole = canonicalRole;
          if ((canonicalRoleLower === 'mlead' || canonicalRoleLower === 'teamlead') && canonicalRole !== targetUser.role) {
            roleChangedToMlead = true;
          }
          revokeTokens = true;
        }

        const resultingRoleLower = (resultingRole || '').toLowerCase();

        if (entry.teamLead !== undefined) {
          // C15: only honor explicit input. If caller cleared the field we
          // leave it untouched (preserved later by the role-aware block
          // below) instead of silently reassigning to the requester.
          const rawTeamLead = typeof entry.teamLead === 'string' ? entry.teamLead : targetUser.teamLead;
          const formattedTeamLead = this.formatNameValue(rawTeamLead);
          if (formattedTeamLead) {
            updatePayload.teamLead = formattedTeamLead;
          }
        } else if (roleChangedToMlead && derivedSelfName) {
          updatePayload.teamLead = derivedSelfName;
        }

        if (entry.manager !== undefined) {
          const rawManager = typeof entry.manager === 'string' ? entry.manager : targetUser.manager;
          const formattedManager = this.formatNameValue(rawManager);
          if (formattedManager) {
            updatePayload.manager = formattedManager;
          } else if (roleLevel(resultingRoleLower) === 'teamLead' && derivedSelfName) {
            updatePayload.manager = derivedSelfName;
          }
        } else if (roleChangedToMlead && derivedSelfName) {
          updatePayload.manager = derivedSelfName;
        }

        // C20 — accept legacy + new names side-by-side. Same fixups for
        // manager-moves-marketing-subordinate as before.
        const isManagerLike = requesterNormalized === 'mm' || requesterNormalized === 'manager';
        const isMarketingTarget = ['mam', 'mlead', 'recruiter', 'assistantmanager', 'teamlead'].includes(targetRoleLower);
        if (isManagerLike && isMarketingTarget) {
          if (targetRoleLower === 'mam' || targetRoleLower === 'assistantmanager') {
            delete updatePayload.teamLead;
          }

          if (!updatePayload.manager || updatePayload.manager.trim() === '') {
            if (requesterDisplayName) {
              updatePayload.manager = requesterDisplayName;
            }
          }

          if (['mlead', 'teamlead', 'recruiter'].includes(targetRoleLower) && !updatePayload.teamLead) {
            const existingLead = this.formatNameValue(targetUser.teamLead ?? '');
            if (existingLead) {
              updatePayload.teamLead = existingLead;
            }
          }
        }

        const isLeadLike = requesterNormalized === 'lead' || requesterNormalized === 'teamlead';
        const isUserLike = targetRoleLower === 'user' || targetRoleLower === 'expert';
        if (isLeadLike && isUserLike) {
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

        // C20 — accept `team` updates. Validate against VALID_TEAMS.
        // Admin demotion to team-less is not handled here (admin
        // promotions/demotions go through updateUserRole anyway).
        if (entry.team !== undefined) {
          const t = (entry.team || '').toString().toLowerCase().trim();
          if (t && !VALID_TEAMS.has(t)) {
            throw new Error(`Invalid team "${t}"`);
          }
          updatePayload.team = t || null;
        }

        if (Object.keys(updatePayload).length === 0) {
          throw new Error('No changes provided for this user');
        }

        // C9/C15: validate role/teamLead compatibility on the resulting
        // (role, teamLead) pair — the new role if changed, the new lead if
        // changed, otherwise fall back to the existing values on disk.
        {
          const finalRole = (updatePayload.role || targetUser.role || '').toLowerCase();
          const finalLead = updatePayload.teamLead !== undefined
            ? updatePayload.teamLead
            : targetUser.teamLead;
          const check = this.validateTeamLeadCompatibility(finalRole, finalLead);
          if (!check.valid) {
            throw new Error(`Invalid role/teamLead combination: ${check.reason}`);
          }
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
