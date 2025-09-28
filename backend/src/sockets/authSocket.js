import { authService } from '../services/authService.js';
import { validateSocketLogin, validateSocketRefreshToken, sanitizeObject } from '../middleware/validation.js';
import { socketAsyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

export class AuthSocketHandler {
  constructor() {
    this.authService = authService;
  }

  handleConnection(socket) {
    logger.debug('Auth socket handler connected', { socketId: socket.id });

    socket.on('login', socketAsyncHandler(this.handleLogin.bind(this)));
    socket.on('refresh', socketAsyncHandler(this.handleRefresh.bind(this)));
    socket.on('logout', socketAsyncHandler(this.handleLogout.bind(this)));
  }

  async handleLogin(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('Login callback not provided', { socketId: socket.id });
        return;
      }

      const sanitizedData = sanitizeObject(data);
      const validation = validateSocketLogin(sanitizedData);

      if (!validation.isValid) {
        logger.warn('Login validation failed', {
          errors: validation.errors,
          socketId: socket.id,
          email: sanitizedData.email
        });

        return callback({
          success: false,
          error: 'Validation failed',
          details: validation.errors
        });
      }

      const { email, password } = sanitizedData;

      const result = await this.authService.login(email, password);

      socket.data.user = {
        email: result.user.email,
        role: result.user.role,
        teamLead: result.user.teamLead,
        manager: result.user.manager,
      };

      logger.info('Socket login successful', {
        email: result.user.email,
        role: result.user.role,
        socketId: socket.id
      });

      callback({
        success: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        role: result.user.role,
        teamLead: result.user.teamLead,
        manager: result.user.manager,
      });

    } catch (error) {
      logger.warn('Socket login failed', {
        error: error.message,
        socketId: socket.id,
        email: data?.email
      });

      callback({
        success: false,
        error: error.message
      });
    }
  }

  async handleRefresh(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('Refresh callback not provided', { socketId: socket.id });
        return;
      }

      const sanitizedData = sanitizeObject(data);
      const validation = validateSocketRefreshToken(sanitizedData);

      if (!validation.isValid) {
        logger.warn('Refresh token validation failed', {
          errors: validation.errors,
          socketId: socket.id
        });

        return callback({
          success: false,
          error: 'Validation failed',
          details: validation.errors
        });
      }

      const { refreshToken } = sanitizedData;

      const result = await this.authService.refreshAccessToken(refreshToken);

      logger.debug('Socket token refresh successful', {
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      callback({
        success: true,
        accessToken: result.accessToken
      });

    } catch (error) {
      logger.warn('Socket token refresh failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      callback({
        success: false,
        error: error.message
      });
    }
  }

  async handleLogout(socket, data, callback) {
    try {
      const sanitizedData = sanitizeObject(data || {});
      const { refreshToken } = sanitizedData;

      const userEmail = socket.data.user?.email;

      if (refreshToken) {
        await this.authService.logout(refreshToken);
      }

      // Clear socket user data
      socket.data.user = null;

      logger.info('Socket logout successful', {
        socketId: socket.id,
        userEmail
      });

      if (callback && typeof callback === 'function') {
        callback({
          success: true,
          message: 'Logged out successfully'
        });
      }

    } catch (error) {
      logger.error('Socket logout failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      if (callback && typeof callback === 'function') {
        callback({
          success: false,
          error: error.message
        });
      }
    }
  }

  async handleGetProfile(socket, data, callback) {
    try {
      if (!callback || typeof callback !== 'function') {
        logger.warn('Get profile callback not provided', { socketId: socket.id });
        return;
      }

      const user = socket.data.user;
      if (!user) {
        return callback({
          success: false,
          error: 'Authentication required'
        });
      }

      const profile = await this.authService.getUserProfile(user.email);

      logger.debug('Socket profile retrieved', {
        socketId: socket.id,
        userEmail: user.email
      });

      callback({
        success: true,
        profile: profile.user
      });

    } catch (error) {
      logger.error('Socket get profile failed', {
        error: error.message,
        socketId: socket.id,
        userEmail: socket.data.user?.email
      });

      callback({
        success: false,
        error: error.message
      });
    }
  }
}

export const authSocketHandler = new AuthSocketHandler();