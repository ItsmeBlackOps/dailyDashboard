import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { userModel } from '../models/User.js';
import { logger } from '../utils/logger.js';
import { toLegacyRole } from '../utils/roleAliases.js';

// C20 — collapse both legacy and new role names to a level token so
// every requireRole / requireHTTPRole guard accepts both forms during
// the dual-read window. Without this, post-migration users (whose
// stored role is now 'manager'/'assistantManager'/'teamLead') fail
// every legacy guard like ['admin','mm','mam','mlead','lead','am']
// and get 403 on every request — tasks, branch candidates, user
// management, etc. all break silently for them.
const ROLE_LEVEL_HTTP = new Map([
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
const httpRoleLevel = (r) =>
  ROLE_LEVEL_HTTP.get((r || '').toString().toLowerCase().trim())
  || (r || '').toString().toLowerCase().trim();

export const authenticateSocket = (socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next();
  }

  try {
    const { email } = jwt.verify(token, config.auth.jwtSecret);
    const user = userModel.getUserByEmail(email);

    if (!user) {
      throw new Error('User not found');
    }

    if (user.active === false) {
      throw new Error('Account is inactive');
    }

    // C20 — translate role to legacy form for downstream handlers that
    // still compare against legacy strings. Original new-name role is
    // preserved as roleCanonical for any consumer that needs it.
    socket.data.user = {
      email,
      role: toLegacyRole(user.role, user.team),
      roleCanonical: user.role,
      team: user.team || null,
      teamLead: user.teamLead,
      manager: user.manager,
      active: user.active !== undefined ? Boolean(user.active) : true,
    };

    logger.debug('Socket authenticated', { email, socketId: socket.id });
    next();
  } catch (error) {
    logger.warn('Socket authentication failed', {
      error: error.message,
      socketId: socket.id
    });
    next(new Error('Unauthorized'));
  }
};

export const requireAuthentication = (socket, next) => {
  if (!socket.data.user) {
    logger.warn('Socket access denied - not authenticated', { socketId: socket.id });
    return next(new Error('Authentication required'));
  }
  next();
};

export const requireRole = (roles) => {
  return (socket, next) => {
    const user = socket.data.user;

    if (!user) {
      return next(new Error('Authentication required'));
    }

    const allowedRaw = (Array.isArray(roles) ? roles : [roles])
      .map((role) => (role || '').toString().trim().toLowerCase())
      .filter(Boolean);
    const allowedLevels = new Set(allowedRaw.map(httpRoleLevel));
    const currentRole = (user.role || '').toString().trim().toLowerCase();
    const currentLevel = httpRoleLevel(currentRole);

    if (!allowedRaw.includes(currentRole) && !allowedLevels.has(currentLevel)) {
      logger.warn('Socket access denied - insufficient permissions', {
        userEmail: user.email,
        userRole: user.role,
        userLevel: currentLevel,
        requiredRoles: allowedRaw,
        requiredLevels: [...allowedLevels],
        socketId: socket.id
      });
      return next(new Error('Insufficient permissions'));
    }

    next();
  };
};

export const authenticateHTTP = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authorization header missing or invalid'
    });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret);

    // Scoped tokens (e.g. the meeting-detector extension token) carry a
    // `scope` claim and must NOT be usable on the normal API — only the
    // endpoint that minted their scope accepts them. Normal access/refresh
    // tokens are `{ email }` with no scope, so this never affects them.
    if (decoded.scope) {
      return res.status(401).json({
        success: false,
        error: 'Token not valid for this endpoint'
      });
    }

    const { email } = decoded;
    const user = userModel.getUserByEmail(email);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    if (user.active === false) {
      return res.status(403).json({
        success: false,
        error: 'Account is inactive'
      });
    }

    // C20 — translate role to legacy form. See socket equivalent above.
    req.user = {
      email,
      role: toLegacyRole(user.role, user.team),
      roleCanonical: user.role,
      team: user.team || null,
      teamLead: user.teamLead,
      manager: user.manager,
      active: user.active !== undefined ? Boolean(user.active) : true,
    };

    logger.debug('HTTP request authenticated', { email, path: req.path });
    next();
  } catch (error) {
    logger.warn('HTTP authentication failed', {
      error: error.message,
      path: req.path
    });

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired'
      });
    }

    return res.status(401).json({
      success: false,
      error: 'Invalid token'
    });
  }
};

export const requireHTTPRole = (roles) => {
  return (req, res, next) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const allowedRaw = (Array.isArray(roles) ? roles : [roles])
      .map((role) => (role || '').toString().trim().toLowerCase())
      .filter(Boolean);
    const allowedLevels = new Set(allowedRaw.map(httpRoleLevel));
    const currentRole = (user.role || '').toString().trim().toLowerCase();
    const currentLevel = httpRoleLevel(currentRole);

    // Allow if either the raw role or its collapsed level matches.
    if (!allowedRaw.includes(currentRole) && !allowedLevels.has(currentLevel)) {
      logger.warn('HTTP access denied - insufficient permissions', {
        userEmail: user.email,
        userRole: user.role,
        userLevel: currentLevel,
        requiredRoles: allowedRaw,
        requiredLevels: [...allowedLevels],
        path: req.path
      });

      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions'
      });
    }

    next();
  };
};

// Validates the meeting-detector extension token (scope='meeting-presence').
// Distinct from authenticateHTTP: it ONLY accepts the scoped token and never
// touches req.user / role gates — it just identifies which expert is
// reporting presence. Used solely by the meeting-presence report endpoint.
export const authenticateMeetingDetector = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authorization header missing or invalid' });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret);
    if (decoded.scope !== 'meeting-presence' || !decoded.email) {
      return res.status(401).json({ success: false, error: 'Invalid detector token' });
    }
    const user = userModel.getUserByEmail(decoded.email);
    if (!user || user.active === false) {
      return res.status(401).json({ success: false, error: 'Detector account not found or inactive' });
    }
    req.detectorEmail = decoded.email;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Detector token expired — re-enroll the extension' });
    }
    return res.status(401).json({ success: false, error: 'Invalid detector token' });
  }
};
