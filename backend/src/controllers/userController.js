import { userService } from '../services/userService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { database } from '../config/database.js';

// Use the service-level helper as the single source of truth (was a
// duplicate impl that split on `[._]` only — service version handles
// `[._\s-]+` which is the right behavior for hyphenated emails).
const nameFromEmail = (email) => userService.deriveDisplayNameFromEmail(email);

export class UserController {
  constructor() {
    this.userService = userService;
  }

  getAllUsers = asyncHandler(async (req, res) => {
    const requestingUser = req.user;

    const result = await this.userService.getAllUsers(
      requestingUser.email,
      requestingUser.role
    );

    res.status(200).json(result);
  });

  getUsersByRole = asyncHandler(async (req, res) => {
    const requestingUser = req.user;
    const { role } = req.params;

    const result = await this.userService.getUsersByRole(
      role,
      requestingUser.email,
      requestingUser.role
    );

    res.status(200).json(result);
  });

  getTeamMembers = asyncHandler(async (req, res) => {
    const user = req.user;

    const result = await this.userService.getTeamMembers(
      user.email,
      user.role,
      user.teamLead
    );

    res.status(200).json(result);
  });

  getManageableUsers = asyncHandler(async (req, res) => {
    const requestingUser = req.user;

    const result = await this.userService.getManageableUsers(requestingUser);

    res.status(200).json(result);
  });

  updateUserRole = asyncHandler(async (req, res) => {
    const requestingUser = req.user;
    const { email } = req.params;
    const { role } = req.body;

    const result = await this.userService.updateUserRole(
      email,
      role,
      requestingUser.email,
      requestingUser.role
    );

    res.status(200).json(result);
  });

  updateUserTeamLead = asyncHandler(async (req, res) => {
    const requestingUser = req.user;
    const { email } = req.params;
    const { teamLead } = req.body;

    const result = await this.userService.updateUserTeamLead(
      email,
      teamLead,
      requestingUser.email,
      requestingUser.role
    );

    res.status(200).json(result);
  });

  deleteUser = asyncHandler(async (req, res) => {
    const requestingUser = req.user;
    const { email } = req.params;

    const result = await this.userService.deleteUser(
      email,
      requestingUser.email,
      requestingUser.role
    );

    res.status(200).json(result);
  });

  getUserStats = asyncHandler(async (req, res) => {
    const requestingUser = req.user;

    const result = await this.userService.getUserStats(
      requestingUser.email,
      requestingUser.role
    );

    res.status(200).json(result);
  });

  searchUsers = asyncHandler(async (req, res) => {
    const requestingUser = req.user;
    const { q: searchTerm } = req.query;

    if (!searchTerm) {
      return res.status(400).json({
        success: false,
        error: 'Search term is required'
      });
    }

    const result = await this.userService.searchUsers(
      searchTerm,
      requestingUser.email,
      requestingUser.role
    );

    res.status(200).json(result);
  });

  getUserChangeHistory = asyncHandler(async (req, res) => {
    const { email } = req.params;
    const requestingUser = req.user;
    if (!this._canReadProfile(requestingUser, email)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    const result = await this.userService.getUserChangeHistory(email);
    res.status(200).json(result);
  });

  // C8 — hierarchy-aware profile-read gate. Allowed if any of:
  //   1. self
  //   2. requester role is admin or mm (org-wide read)
  //   3. target email is a subordinate (direct or transitive) of requester
  _canReadProfile(requestingUser, targetEmail) {
    if (!requestingUser?.email) return false;
    const role = (requestingUser.role || '').toLowerCase();
    if (targetEmail === requestingUser.email) return true;
    if (['admin', 'mm'].includes(role)) return true;
    return this.userService.isUserInRequesterHierarchy(requestingUser, targetEmail);
  }

  getUserProfile = asyncHandler(async (req, res) => {
    const { email } = req.params;
    const requestingUser = req.user;

    // C8: profile-read is allowed for self, admin/mm, OR users in the
    // requester's own hierarchy (direct/transitive teamLead BFS).
    if (!this._canReadProfile(requestingUser, email)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions'
      });
    }

    const result = await this.userService.getUserProfile(email);

    res.status(200).json(result);
  });

  updateUserProfile = asyncHandler(async (req, res) => {
    const { email } = req.params;
    const requestingUser = req.user;
    const updateData = req.body;

    const result = await this.userService.updateUserProfile(
      email,
      updateData,
      requestingUser.email,
      requestingUser.role
    );

    res.status(200).json(result);
  });

  updateUserPassword = asyncHandler(async (req, res) => {
    const { email } = req.params;
    const { password } = req.body ?? {};
    const requestingUser = req.user;

    const result = await this.userService.updateUserPassword(
      email,
      password,
      requestingUser.email,
      requestingUser.role
    );

    res.status(200).json(result);
  });

  bulkCreateUsers = asyncHandler(async (req, res) => {
    const requestingUser = req.user;
    const payload = Array.isArray(req.body) ? req.body : req.body?.users;

    const result = await this.userService.bulkCreateUsers(requestingUser, payload);

    res.status(result.failures.length === 0 ? 201 : 207).json({
      success: result.failures.length === 0,
      ...result
    });
  });

  bulkUpdateUsers = asyncHandler(async (req, res) => {
    const requestingUser = req.user;
    const payload = Array.isArray(req.body) ? req.body : req.body?.users;

    const result = await this.userService.bulkUpdateUsers(requestingUser, payload);

    res.status(result.failures.length === 0 ? 200 : 207).json({
      success: result.failures.length === 0,
      ...result
    });
  });

  healthCheck = asyncHandler(async (req, res) => {
    res.status(200).json({
      success: true,
      message: 'User service is healthy',
      timestamp: new Date().toISOString()
    });
  });

  getActiveUsers = asyncHandler(async (req, res) => {
    try {
      const db = database.getDatabase();
      const roleParam = (req.query.role || '').toString().trim();
      // Verified: 0 docs have null/missing `active` post-cleanup, so the
      // legacy defensive `$or` was dead. Strict `active: true` now.
      const filter = { active: true };
      if (roleParam) {
        // Accept comma-separated roles, case-insensitive.
        const roles = roleParam.split(',').map(r => r.trim().toLowerCase()).filter(Boolean);
        filter.role = { $in: roles };
      }
      const docs = await db.collection('users')
        .find(filter)
        .project({ email: 1, role: 1, teamLead: 1, manager: 1, name: 1, displayName: 1 })
        .toArray();
      const users = docs.map(u => ({
        email: u.email,
        name: u.displayName || u.name || nameFromEmail(u.email),
        role: u.role,
        teamLead: u.teamLead || '',
        manager: u.manager || '',
      }));
      const byRole = {};
      for (const u of users) {
        (byRole[u.role] = byRole[u.role] || []).push(u);
      }
      return res.json({ success: true, users, byRole });
    } catch (error) {
      logger.error('getActiveUsers failed', { error: error.message });
      return res.status(500).json({ success: false, error: error.message });
    }
  });
}

export const userController = new UserController();
