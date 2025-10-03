import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

export class UserModel {
  constructor() {
    this.collection = null;
    this.cache = new Map();
  }

  async initialize() {
    this.collection = database.getCollection('users');
    await this.loadUsers();
    this.setupChangeStream();
  }

  async loadUsers() {
    try {
      const users = await this.collection.find().toArray();
      this.cache.clear();

      for (const user of users) {
        this.cache.set(user.email.toLowerCase(), {
          passwordHash: user.passwordHash,
          role: user.role,
          teamLead: user.teamLead,
          manager: user.manager,
          active: user.active !== undefined ? Boolean(user.active) : true,
          profile: user.profile || null,
          _id: user._id
        });
      }

      logger.info(`✅ Loaded ${this.cache.size} users into cache`);
    } catch (error) {
      logger.error('Failed to load users', { error: error.message });
      throw error;
    }
  }

  setupChangeStream() {
    try {
      const changeStream = this.collection.watch();

      changeStream.on('change', async (change) => {
        try {
          if (change.operationType === 'delete') {
            await this.loadUsers();
          } else {
            const doc = change.fullDocument ||
              await this.collection.findOne({ _id: change.documentKey._id });

            if (doc) {
              this.cache.set(doc.email.toLowerCase(), {
                passwordHash: doc.passwordHash,
                role: doc.role,
                teamLead: doc.teamLead,
                manager: doc.manager,
                active: doc.active !== undefined ? Boolean(doc.active) : true,
                profile: doc.profile || null,
                _id: doc._id
              });
              logger.debug('🔄 User cache updated', { email: doc.email });
            }
          }
        } catch (error) {
          logger.error('Change stream processing error', { error: error.message });
        }
      });

      changeStream.on('error', (error) => {
        logger.error('User change stream error', { error: error.message });
      });

    } catch (error) {
      logger.error('Failed to setup user change stream', { error: error.message });
    }
  }

  getUserByEmail(email) {
    return this.cache.get(email.toLowerCase()) || null;
  }

  async createUser(userData) {
    try {
      let passwordHash = userData.passwordHash;

      if (!passwordHash) {
        if (!userData.password) {
          throw new Error('Password is required when passwordHash is not provided');
        }

        passwordHash = crypto.createHash('sha256')
          .update(userData.password)
          .digest('hex');
      }

      const user = {
        email: userData.email.toLowerCase(),
        passwordHash,
        role: userData.role || 'user',
        teamLead: userData.teamLead || null,
        manager: userData.manager || null,
        active: userData.active !== undefined ? Boolean(userData.active) : true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      delete userData.password;
      delete userData.passwordHash;

      const result = await this.collection.insertOne(user);
      logger.info('User created', { email: user.email, id: result.insertedId });

      return result;
    } catch (error) {
      logger.error('Failed to create user', { error: error.message, email: userData.email });
      throw error;
    }
  }

  async updateUser(email, updateData) {
    try {
      const update = {
        ...updateData,
        updatedAt: new Date()
      };

      if (updateData.password) {
        update.passwordHash = crypto.createHash('sha256')
          .update(updateData.password)
          .digest('hex');
        delete update.password;
      }

      if (updateData.active !== undefined) {
        update.active = Boolean(updateData.active);
      }

      const result = await this.collection.updateOne(
        { email: email.toLowerCase() },
        { $set: update }
      );

      logger.info('User updated', { email, modifiedCount: result.modifiedCount });
      return result;
    } catch (error) {
      logger.error('Failed to update user', { error: error.message, email });
      throw error;
    }
  }

  async deleteUser(email) {
    try {
      const result = await this.collection.deleteOne({ email: email.toLowerCase() });
      logger.info('User deleted', { email, deletedCount: result.deletedCount });
      return result;
    } catch (error) {
      logger.error('Failed to delete user', { error: error.message, email });
      throw error;
    }
  }

  async getUserProfileMetadata(email) {
    if (!this.collection) {
      throw new Error('User collection not initialized');
    }

    if (!email) {
      throw new Error('Email is required');
    }

    const lowerEmail = email.toLowerCase();

    const document = await this.collection.findOne(
      { email: lowerEmail },
      {
        projection: {
          email: 1,
          profile: 1,
          createdAt: 1,
          updatedAt: 1
        }
      }
    );

    if (!document) {
      return null;
    }

    return {
      email: document.email,
      metadata: document.profile || {},
      created_at: document.createdAt || null,
      updated_at: document.updatedAt || null
    };
  }

  async upsertUserProfileMetadata(email, metadata = {}) {
    if (!this.collection) {
      throw new Error('User collection not initialized');
    }

    if (!email) {
      throw new Error('Email is required');
    }

    const lowerEmail = email.toLowerCase();

    const userRecord = await this.collection.findOne(
      { email: lowerEmail },
      {
        projection: { _id: 0, email: 1 }
      }
    );

    if (!userRecord) {
      const error = new Error('User not found');
      error.statusCode = 404;
      throw error;
    }

    const now = new Date();
    const storedProfile = {
      ...metadata,
      updatedAt: now
    };

    const updateDoc = {
      $set: {
        profile: storedProfile,
        updatedAt: now
      }
    };

    const result = await this.collection.updateOne({ email: lowerEmail }, updateDoc);

    const cached = this.cache.get(lowerEmail) || {};
    this.cache.set(lowerEmail, {
      ...cached,
      profile: storedProfile
    });

    return result;
  }

  getTeamEmails(userEmail, userRole, teamLead) {
    const lowerEmail = userEmail.toLowerCase();
    const normalizedRole = (userRole || '').toLowerCase();

    if (normalizedRole === 'am') {
      const experts = new Set([lowerEmail]);
      const allUsers = Array.from(this.cache.entries());

      const amDisplayName = this.formatDisplayNameFromEmail(userEmail);
      const normalizedAmName = (amDisplayName || '').trim().toLowerCase();
      const leadNameToEmail = new Map();

      for (const [email, user] of allUsers) {
        const roleKey = (user.role || '').toLowerCase();
        if (roleKey !== 'lead') continue;
        const teamLeadName = (user.teamLead || '').trim().toLowerCase();
        if (teamLeadName === normalizedAmName) {
          experts.add(email);
          const normalizedLeadName = this.formatDisplayNameFromEmail(email)?.toLowerCase();
          if (normalizedLeadName) {
            leadNameToEmail.set(normalizedLeadName, email);
          }
        }
      }

      for (const [email, user] of allUsers) {
        const roleKey = (user.role || '').toLowerCase();
        if (roleKey !== 'user') continue;
        const userLeadName = (user.teamLead || '').trim().toLowerCase();
        if (leadNameToEmail.has(userLeadName)) {
          experts.add(email);
        }
      }

      return Array.from(experts);
    }

    if (normalizedRole !== 'lead') {
      return [lowerEmail];
    }

    const fullName = this.formatDisplayNameFromEmail(userEmail);
    const normalizedFullName = (fullName || '').trim().toLowerCase();

    return Array.from(this.cache.entries())
      .filter(([email, user]) => {
        const teamLeadMatch = (user.teamLead || '').trim().toLowerCase() === normalizedFullName;
        const emailMatch = email === lowerEmail;
        return teamLeadMatch || emailMatch;
      })
      .map(([email]) => email);
  }

  formatDisplayNameFromEmail(email) {
    const local = (email || '').split('@')[0];
    const parts = local.split('.').filter(Boolean);
    if (parts.length < 1) {
      return (email || '').split('@')[0];
    }
    return parts
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  getAllUsers() {
    return Array.from(this.cache.entries()).map(([email, user]) => ({
      email,
      ...user
    }));
  }
}

export const userModel = new UserModel();
