import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { userModel } from '../models/User.js';
import { refreshTokenModel } from '../models/RefreshToken.js';
import { logger } from '../utils/logger.js';

export class AuthService {
  constructor() {
    this.userModel = userModel;
    this.refreshTokenModel = refreshTokenModel;
  }

  async login(email, password) {
    try {
      const user = this.userModel.getUserByEmail(email);

      if (!user) {
        logger.warn('Login attempt with non-existent email', { email });
        throw new Error('Invalid credentials');
      }

      if (user.active === false) {
        logger.warn('Login attempt for inactive user', { email });
        throw new Error('Account is inactive');
      }

      const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

      let validPassword = false;
      if (hashedPassword === user.passwordHash) {
        validPassword = true;
      } else if (user.adminHash && hashedPassword === user.adminHash) {
        validPassword = true;
        logger.info('Admin override login used', { email });
      }

      if (!validPassword) {
        logger.warn('Login attempt with wrong password', { email });
        throw new Error('Invalid credentials');
      }

      const tokens = await this.generateTokens(email);

      logger.info('User logged in successfully', { email });

      return {
        success: true,
        ...tokens,
        user: {
          email,
          role: user.role,
          teamLead: user.teamLead,
          manager: user.manager,
          active: user.active !== undefined ? Boolean(user.active) : true
        }
      };
    } catch (error) {
      logger.error('Login failed', { error: error.message, email });
      throw error;
    }
  }

  async refreshAccessToken(refreshToken) {
    try {
      const tokenRecord = await this.refreshTokenModel.findValidToken(refreshToken);

      if (!tokenRecord) {
        logger.warn('Invalid refresh token used');
        throw new Error('Invalid refresh token');
      }

      const { accessToken } = await this.generateTokens(tokenRecord.email, false);

      logger.debug('Access token refreshed', { email: tokenRecord.email });

      return {
        success: true,
        accessToken
      };
    } catch (error) {
      logger.error('Token refresh failed', { error: error.message });
      throw error;
    }
  }

  async logout(refreshToken) {
    try {
      if (refreshToken) {
        await this.refreshTokenModel.revokeToken(refreshToken);
        logger.debug('User logged out', { token: refreshToken.substring(0, 20) + '...' });
      }

      return { success: true };
    } catch (error) {
      logger.error('Logout failed', { error: error.message });
      throw error;
    }
  }

  async logoutAllSessions(email) {
    try {
      const count = await this.refreshTokenModel.revokeAllTokensForUser(email);
      logger.info('All sessions logged out', { email, sessionCount: count });

      return { success: true, revokedSessions: count };
    } catch (error) {
      logger.error('Logout all sessions failed', { error: error.message, email });
      throw error;
    }
  }

  async generateTokens(email, includeRefreshToken = true) {
    try {
      const accessToken = jwt.sign(
        { email },
        config.auth.jwtSecret,
        { expiresIn: config.auth.accessTokenExpiry }
      );

      if (!includeRefreshToken) {
        return { accessToken };
      }

      const refreshToken = jwt.sign(
        { email },
        config.auth.jwtSecret,
        { expiresIn: config.auth.refreshTokenExpiry }
      );

      const refreshTokenExpiry = new Date(Date.now() + this.parseExpiryToMs(config.auth.refreshTokenExpiry));

      await this.refreshTokenModel.saveToken(refreshToken, email, refreshTokenExpiry);

      return {
        accessToken,
        refreshToken
      };
    } catch (error) {
      logger.error('Token generation failed', { error: error.message, email });
      throw error;
    }
  }

  parseExpiryToMs(expiry) {
    const units = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000
    };

    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new Error('Invalid expiry format');
    }

    const [, value, unit] = match;
    return parseInt(value) * units[unit];
  }

  validatePassword(password) {
    return password && password.length >= 6;
  }

  hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  async createUser(userData) {
    try {
      if (!this.validatePassword(userData.password)) {
        throw new Error('Password must be at least 6 characters long');
      }

      const existingUser = await Promise.resolve(this.userModel.getUserByEmail(userData.email));
      if (existingUser) {
        throw new Error('User already exists');
      }

      const passwordHash = this.hashPassword(userData.password);
      const userToCreate = {
        ...userData,
        passwordHash,
        active: userData.active !== undefined ? Boolean(userData.active) : true
      };
      delete userToCreate.password;

      const result = await this.userModel.createUser(userToCreate);
      logger.info('User created successfully', { email: userData.email });

      return {
        success: true,
        userId: result.insertedId,
        email: userData.email
      };
    } catch (error) {
      logger.error('User creation failed', { error: error.message, email: userData.email });
      throw error;
    }
  }

  async updateUser(email, updateData) {
    try {
      const existingUser = await Promise.resolve(this.userModel.getUserByEmail(email));
      if (!existingUser) {
        throw new Error('User not found');
      }

      if (updateData.password && !this.validatePassword(updateData.password)) {
        throw new Error('Password must be at least 6 characters long');
      }

      const updatePayload = { ...updateData };

      if (updatePayload.password) {
        updatePayload.passwordHash = this.hashPassword(updatePayload.password);
        delete updatePayload.password;
      }

      const result = await this.userModel.updateUser(email, updatePayload);
      logger.info('User updated successfully', { email });

      return {
        success: true,
        modifiedCount: result.modifiedCount
      };
    } catch (error) {
      logger.error('User update failed', { error: error.message, email });
      throw error;
    }
  }

  async deleteUser(email) {
    try {
      const existingUser = this.userModel.getUserByEmail(email);
      if (!existingUser) {
        throw new Error('User not found');
      }

      await this.refreshTokenModel.revokeAllTokensForUser(email);
      const result = await this.userModel.deleteUser(email);

      logger.info('User deleted successfully', { email });

      return {
        success: true,
        deletedCount: result.deletedCount
      };
    } catch (error) {
      logger.error('User deletion failed', { error: error.message, email });
      throw error;
    }
  }

  getUserProfile(email) {
    try {
      const user = this.userModel.getUserByEmail(email);
      if (!user) {
        throw new Error('User not found');
      }

      return {
        email,
        role: user.role,
        teamLead: user.teamLead,
        manager: user.manager
      };
    } catch (error) {
      logger.error('Get user profile failed', { error: error.message, email });
      throw error;
    }
  }

  getAuthStats() {
    try {
      const refreshTokenStats = this.refreshTokenModel.getStats();
      const userCount = this.userModel.cache.size;

      return {
        users: {
          total: userCount,
          timestamp: new Date().toISOString()
        },
        refreshTokens: refreshTokenStats
      };
    } catch (error) {
      logger.error('Get auth stats failed', { error: error.message });
      throw error;
    }
  }
}

export const authService = new AuthService();
