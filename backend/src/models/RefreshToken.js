import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class RefreshTokenModel {
  constructor() {
    this.collection = null;
    this.cache = new Map(); // token -> { email, expiresAt, createdAt, cachedAt }
    this.cleanupInterval = null;
  }

  async initialize() {
    this.collection = database.getCollection('refreshTokens');
    await this.createIndexes();
    this.cache.clear();
    this.startCleanupJob();
  }

  async createIndexes() {
    try {
      await this.collection.createIndex({ token: 1 }, { unique: true });
      await this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await this.collection.createIndex({ email: 1 });

      logger.info('Refresh token indexes created');
    } catch (error) {
      logger.error('Failed to create refresh token indexes', { error: error.message });
    }
  }

  async saveToken(token, email, expiresAt) {
    try {
      const tokenDoc = {
        token,
        email: email.toLowerCase(),
        expiresAt,
        createdAt: new Date()
      };

      await this.collection.insertOne(tokenDoc);
      this.cache.set(token, {
        email: tokenDoc.email,
        expiresAt,
        createdAt: tokenDoc.createdAt,
        cachedAt: Date.now()
      });

      logger.debug('Refresh token saved', { email, expiresAt });
    } catch (error) {
      logger.error('Failed to save refresh token', { error: error.message, email });
      throw error;
    }
  }

  async findValidToken(token) {
    if (!token) {
      return null;
    }

    const cached = this.cache.get(token);
    if (cached) {
      if (cached.expiresAt > new Date() && Date.now() - cached.cachedAt < TOKEN_CACHE_TTL_MS) {
        return cached;
      }
      this.cache.delete(token);
    }

    try {
      const doc = await this.collection.findOne({
        token,
        expiresAt: { $gt: new Date() }
      }, {
        projection: {
          token: 1,
          email: 1,
          expiresAt: 1,
          createdAt: 1
        }
      });

      const now = new Date();

      if (!doc || doc.expiresAt <= now) {
        if (doc?.token) {
          await this.collection.deleteOne({ token });
        }
        return null;
      }

      const entry = {
        email: doc.email,
        expiresAt: doc.expiresAt,
        createdAt: doc.createdAt,
        cachedAt: Date.now()
      };

      this.cache.set(token, entry);
      return entry;
    } catch (error) {
      logger.error('Failed to lookup refresh token', { error: error.message });
      throw error;
    }
  }

  async isValidToken(token) {
    const record = await this.findValidToken(token);
    return Boolean(record);
  }

  async getTokenEmail(token) {
    const tokenData = await this.findValidToken(token);
    return tokenData ? tokenData.email : null;
  }

  async revokeToken(token) {
    try {
      await this.collection.deleteOne({ token });
      this.cache.delete(token);

      logger.debug('Refresh token revoked', { token: token.substring(0, 20) + '...' });
    } catch (error) {
      logger.error('Failed to revoke refresh token', { error: error.message });
      throw error;
    }
  }

  async revokeAllTokensForUser(email) {
    try {
      const lower = email.toLowerCase();

      const tokens = await this.collection.find({ email: lower }, { projection: { token: 1 } }).toArray();
      const result = await this.collection.deleteMany({ email: lower });

      for (const token of tokens) {
        if (token?.token) {
          this.cache.delete(token.token);
        }
      }

      // Remove any cached entries that may not have been returned by the query (defensive cleanup)
      for (const [tokenValue, tokenData] of this.cache.entries()) {
        if (tokenData.email === lower) {
          this.cache.delete(tokenValue);
        }
      }

      logger.info('All tokens revoked for user', { email, count: result.deletedCount });
      return result.deletedCount;
    } catch (error) {
      logger.error('Failed to revoke all tokens for user', { error: error.message, email });
      throw error;
    }
  }

  async cleanupExpiredTokens() {
    try {
      const result = await this.collection.deleteMany({
        expiresAt: { $lte: new Date() }
      });

      // Clean cache
      const now = Date.now();
      const entries = Array.from(this.cache.entries());
      for (const [token, tokenData] of entries) {
        if (tokenData.expiresAt <= new Date() || now - tokenData.cachedAt >= TOKEN_CACHE_TTL_MS) {
          this.cache.delete(token);
        }
      }

      if (result.deletedCount > 0) {
        logger.info('Expired refresh tokens cleaned up', { count: result.deletedCount });
      }

      return result.deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup expired tokens', { error: error.message });
    }
  }

  startCleanupJob() {
    if (this.cleanupInterval) {
      return;
    }

    // Run cleanup every hour and allow tests to terminate cleanly
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, 60 * 60 * 1000);

    if (typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }

    logger.info('Refresh token cleanup job started (every hour)');
  }

  stopCleanupJob() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.info('Refresh token cleanup job stopped');
    }
  }

  getStats() {
    const now = new Date();
    let validCount = 0;
    let expiredCount = 0;

    for (const tokenData of this.cache.values()) {
      if (tokenData.expiresAt > now) {
        validCount++;
      } else {
        expiredCount++;
      }
    }

    return {
      total: this.cache.size,
      valid: validCount,
      expired: expiredCount,
      timestamp: now.toISOString()
    };
  }
}

export const refreshTokenModel = new RefreshTokenModel();
