import { userService } from '../services/userService.js';
import { userModel } from '../models/User.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { database } from '../config/database.js';
import { TECHNICAL_ACK, TECHNICAL_ACK_ROLES } from '../config/technicalAck.js';
import { MARKETING_MEETING_ACK, MARKETING_MEETING_ACK_ROLES } from '../config/marketingMeetingAck.js';

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

  // C8 — hierarchy-aware profile-read gate. Allowed if any of:
  //   1. self
  //   2. requester role is admin or mm (org-wide read)
  //   3. target email is a subordinate (direct or transitive) of requester
  // C19 phase 2 — now async because isUserInRequesterHierarchy unions
  // in active delegations to the requester.
  async _canReadProfile(requestingUser, targetEmail) {
    if (!requestingUser?.email) return false;
    const role = (requestingUser.role || '').toLowerCase();
    if (targetEmail === requestingUser.email) return true;
    if (['admin', 'mm'].includes(role)) return true;
    return this.userService.isUserInRequesterHierarchy(requestingUser, targetEmail);
  }

  getUserChangeHistory = asyncHandler(async (req, res) => {
    const { email } = req.params;
    const requestingUser = req.user;
    if (!(await this._canReadProfile(requestingUser, email))) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions' });
    }
    const result = await this.userService.getUserChangeHistory(email);
    res.status(200).json(result);
  });

  getUserProfile = asyncHandler(async (req, res) => {
    const { email } = req.params;
    const requestingUser = req.user;

    // C8: profile-read is allowed for self, admin/mm, OR users in the
    // requester's own hierarchy (direct/transitive teamLead BFS).
    if (!(await this._canReadProfile(requestingUser, email))) {
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

  // PRT Phase 4: read the signed-in user's preferences subdoc.
  getMyPreferences = asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user?.email) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    try {
      const record = userModel.getUserByEmail(user.email) || {};
      const preferences = record.preferences || {};
      return res.json({
        success: true,
        preferences: {
          eadEmailAlerts: Boolean(preferences.eadEmailAlerts)
        }
      });
    } catch (error) {
      logger.error('getMyPreferences failed', { error: error.message, email: user.email });
      return res.status(500).json({ success: false, error: 'Unable to read preferences' });
    }
  });

  // PRT Phase 4: write the signed-in user's preferences subdoc.
  // Only `eadEmailAlerts` is recognised in v1; future keys plug in here
  // with the same dot-notation $set pattern (no overwrite of siblings).
  updateMyPreferences = asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user?.email) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const body = req.body || {};
    if (!('eadEmailAlerts' in body)) {
      return res.status(400).json({ success: false, error: 'eadEmailAlerts is required' });
    }
    const value = body.eadEmailAlerts;
    if (typeof value !== 'boolean') {
      return res.status(400).json({ success: false, error: 'eadEmailAlerts must be a boolean' });
    }
    try {
      await userModel.updateUser(user.email, {
        // Dot-notation so we $set ONLY the eadEmailAlerts subfield and
        // don't accidentally wipe sibling preferences added later.
        'preferences.eadEmailAlerts': value,
        _changedBy: user.email,
        _source: 'self-preferences'
      });
      return res.json({
        success: true,
        preferences: { eadEmailAlerts: value }
      });
    } catch (error) {
      logger.error('updateMyPreferences failed', { error: error.message, email: user.email });
      return res.status(500).json({ success: false, error: 'Unable to update preferences' });
    }
  });

  // SP2 — one-time, versioned technical-team acknowledgment status.
  getMyTechnicalAck = asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user?.email) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const role = (user.role || '').trim().toLowerCase();
    const currentVersion = TECHNICAL_ACK.version;
    if (!TECHNICAL_ACK_ROLES.includes(role)) {
      return res.json({ success: true, required: false, currentVersion, agreedVersion: 0, content: null });
    }
    try {
      const record = userModel.getUserByEmail(user.email) || {};
      const agreedVersion = Number(record.technicalAck?.version) || 0;
      const required = agreedVersion !== currentVersion;
      return res.json({
        success: true,
        required,
        currentVersion,
        agreedVersion,
        content: required
          ? { version: currentVersion, title: TECHNICAL_ACK.title, sections: TECHNICAL_ACK.sections }
          : null,
      });
    } catch (error) {
      logger.error('getMyTechnicalAck failed', { error: error.message, email: user.email });
      return res.status(500).json({ success: false, error: 'Unable to read acknowledgment status' });
    }
  });

  // SP2 — record agreement to the current version.
  updateMyTechnicalAck = asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user?.email) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const currentVersion = TECHNICAL_ACK.version;
    const version = Number(req.body?.version);
    if (!version || version !== currentVersion) {
      return res.status(400).json({ success: false, error: `version must equal the current version (${currentVersion})` });
    }
    try {
      const agreedAt = new Date().toISOString();
      await userModel.updateUser(user.email, {
        'technicalAck.version': currentVersion,
        'technicalAck.agreedAt': agreedAt,
        _changedBy: user.email,
        _source: 'self-technical-ack',
      });
      return res.json({ success: true, required: false, currentVersion, agreedVersion: currentVersion });
    } catch (error) {
      logger.error('updateMyTechnicalAck failed', { error: error.message, email: user.email });
      return res.status(500).json({ success: false, error: 'Unable to record acknowledgment' });
    }
  });

  // Marketing-team one-time, versioned acknowledgment of the meeting status mark.
  getMyMarketingMeetingAck = asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user?.email) return res.status(401).json({ success: false, error: 'Authentication required' });
    const role = (user.role || '').trim().toLowerCase();
    const currentVersion = MARKETING_MEETING_ACK.version;
    if (!MARKETING_MEETING_ACK_ROLES.includes(role)) {
      return res.json({ success: true, required: false, currentVersion, agreedVersion: 0 });
    }
    try {
      const record = userModel.getUserByEmail(user.email) || {};
      const agreedVersion = Number(record.marketingMeetingAck?.version) || 0;
      return res.json({ success: true, required: agreedVersion !== currentVersion, currentVersion, agreedVersion });
    } catch (error) {
      logger.error('getMyMarketingMeetingAck failed', { error: error.message, email: user.email });
      return res.status(500).json({ success: false, error: 'Unable to read acknowledgment status' });
    }
  });

  updateMyMarketingMeetingAck = asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user?.email) return res.status(401).json({ success: false, error: 'Authentication required' });
    const currentVersion = MARKETING_MEETING_ACK.version;
    const version = Number(req.body?.version);
    if (!version || version !== currentVersion) {
      return res.status(400).json({ success: false, error: `version must equal the current version (${currentVersion})` });
    }
    try {
      await userModel.updateUser(user.email, {
        'marketingMeetingAck.version': currentVersion,
        'marketingMeetingAck.agreedAt': new Date().toISOString(),
        _changedBy: user.email,
        _source: 'self-marketing-meeting-ack',
      });
      return res.json({ success: true, required: false, currentVersion, agreedVersion: currentVersion });
    } catch (error) {
      logger.error('updateMyMarketingMeetingAck failed', { error: error.message, email: user.email });
      return res.status(500).json({ success: false, error: 'Unable to record acknowledgment' });
    }
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
        .project({ email: 1, role: 1, team: 1, teamLead: 1, manager: 1, name: 1, displayName: 1, acceptsTasks: 1 })
        .toArray();
      const users = docs.map(u => ({
        email: u.email,
        name: u.displayName || u.name || nameFromEmail(u.email),
        role: u.role,
        team: u.team || null,
        teamLead: u.teamLead || '',
        manager: u.manager || '',
        // Surfaces the "this user takes interview assignments" flag so
        // the frontend Expert dropdown can include teamLeads/AMs who
        // explicitly opt in (Darshan, Anusree, etc.).
        acceptsTasks: u.acceptsTasks === true,
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
