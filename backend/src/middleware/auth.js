import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { userModel } from '../models/User.js';
import { logger } from '../utils/logger.js';

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

    socket.data.user = {
      email,
      role: user.role,
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

    const allowedRoles = (Array.isArray(roles) ? roles : [roles])
      .map((role) => (role || '').toString().trim().toLowerCase())
      .filter(Boolean);
    const currentRole = (user.role || '').toString().trim().toLowerCase();

    if (!allowedRoles.includes(currentRole)) {
      logger.warn('Socket access denied - insufficient permissions', {
        userEmail: user.email,
        userRole: user.role,
        requiredRoles: allowedRoles,
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
    const { email } = jwt.verify(token, config.auth.jwtSecret);
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

    req.user = {
      email,
      role: user.role,
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

    const allowedRoles = (Array.isArray(roles) ? roles : [roles])
      .map((role) => (role || '').toString().trim().toLowerCase())
      .filter(Boolean);
    const currentRole = (user.role || '').toString().trim().toLowerCase();

    if (!allowedRoles.includes(currentRole)) {
      logger.warn('HTTP access denied - insufficient permissions', {
        userEmail: user.email,
        userRole: user.role,
        requiredRoles: allowedRoles,
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
