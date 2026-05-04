import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

// C16 — pre-save validation. Reject malformed user data at write time
// so dirty state never lands in the DB. The D-series audit found rows
// like `teamLead: '"aman Sagar" <aman Sagar'`, self-loops on teamLead,
// and admin users with non-null team that nothing rejected. This
// validator closes those write paths.
const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const VALID_ROLES = new Set([
  // legacy (still accepted during the C20 dual-read window)
  'admin', 'mm', 'mam', 'mlead', 'am', 'lead', 'recruiter', 'user',
  // canonical (post-C20)
  'manager', 'assistantManager', 'teamLead', 'expert',
]);
const VALID_TEAMS = new Set(['technical', 'marketing', 'sales']);
const NAME_FIELD_REGEX = /^[\p{L}][\p{L} .'-]{0,79}$/u; // letter, then up to 79 of letter/space/.'-

const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class UserModel {
  constructor() {
    this.collection = null;
    this.cache = new Map();
  }

  formatCachePayload(userDoc = {}) {
    if (!userDoc?.email) {
      return null;
    }

    return {
      passwordHash: userDoc.passwordHash,
      adminHash: userDoc.adminHash,
      role: userDoc.role,
      team: userDoc.team || null,
      teamLead: userDoc.teamLead,
      manager: userDoc.manager,
      active: userDoc.active !== undefined ? Boolean(userDoc.active) : true,
      // acceptsTasks decouples "do you take interview assignments?" from
      // role. Default true for legacy expert/user; default false for
      // higher levels (teamLead/AM/manager). Admins flip per-user when
      // a lead also does IC work (Darshan, Anusree, Bhavya cases).
      acceptsTasks: userDoc.acceptsTasks !== undefined
        ? Boolean(userDoc.acceptsTasks)
        : ['expert', 'user', 'recruiter'].includes((userDoc.role || '').toLowerCase()),
      profile: userDoc.profile || null,
      _id: userDoc._id
    };
  }

  setCacheEntryFromDocument(userDoc) {
    const payload = this.formatCachePayload(userDoc);
    if (!payload) {
      return;
    }

    const normalizedEmail = userDoc.email.toLowerCase();
    this.cache.set(normalizedEmail, payload);
  }

  async findUserDocumentByEmailCaseInsensitive(email, projection = null) {
    if (!this.collection || !email) {
      return null;
    }

    const lowerEmail = email.toLowerCase();
    const exact = await this.collection.findOne(
      { email: lowerEmail },
      projection ? { projection } : undefined
    );
    if (exact) {
      return exact;
    }

    const regex = new RegExp(`^${escapeRegex(lowerEmail)}$`, 'i');
    return this.collection.findOne(
      { email: regex },
      projection ? { projection } : undefined
    );
  }

  async refreshCacheForEmail(email) {
    if (!this.collection || !email) {
      return;
    }

    const lowerEmail = email.toLowerCase();

    try {
      const document = await this.findUserDocumentByEmailCaseInsensitive(lowerEmail);
      if (document) {
        this.setCacheEntryFromDocument(document);
      } else {
        this.cache.delete(lowerEmail);
      }
    } catch (error) {
      logger.error('Failed to refresh user cache entry', {
        email: lowerEmail,
        error: error.message
      });
    }
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
        this.setCacheEntryFromDocument(user);
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
              this.setCacheEntryFromDocument(doc);
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

  // C16 — pre-save validator. mode = 'create' or 'update'. Throws on
  // invalid input. Coercion-free: callers must pass clean data.
  _validateBeforeWrite(payload, mode) {
    const isCreate = mode === 'create';
    const has = (k) => Object.prototype.hasOwnProperty.call(payload, k);

    // --- email ---
    if (isCreate || has('email')) {
      const raw = payload.email;
      if (typeof raw !== 'string' || !raw.trim()) {
        throw new Error('email is required');
      }
      if (raw !== raw.trim() || raw !== raw.toLowerCase()) {
        throw new Error('email must be lowercased and trimmed');
      }
      if (!EMAIL_REGEX.test(raw)) {
        throw new Error(`email "${raw}" is malformed`);
      }
    }

    // --- role ---
    if (isCreate || has('role')) {
      const r = (payload.role || '').toString();
      if (!r) throw new Error('role is required');
      if (!VALID_ROLES.has(r)) {
        throw new Error(`role "${r}" is not in the canonical enum`);
      }
    }

    // --- team ---
    if (has('team')) {
      const t = payload.team;
      if (t !== null && t !== undefined && t !== '') {
        if (typeof t !== 'string' || !VALID_TEAMS.has(t.toLowerCase())) {
          throw new Error(`team "${t}" must be one of: ${[...VALID_TEAMS].join(', ')} or null`);
        }
      }
    }

    // --- (role, team) combo: admin is team-less; everyone else needs a team ---
    // Only enforce when both are present in this write so partial updates
    // that touch only role OR only team don't trip on the other side.
    if ((isCreate || has('role')) && (isCreate || has('team'))) {
      const r = (payload.role || '').toString().toLowerCase();
      const t = payload.team ? payload.team.toString().toLowerCase() : null;
      const isAdminLike = r === 'admin';
      if (isAdminLike && t) {
        throw new Error('admin users must have team = null');
      }
      if (!isAdminLike && !t && isCreate) {
        // Only on create — updates that don't touch team are fine.
        throw new Error(`role "${r}" requires a team (technical / marketing / sales)`);
      }
    }

    // --- teamLead / manager: well-formed strings, no self-loops ---
    for (const field of ['teamLead', 'manager']) {
      if (!has(field)) continue;
      const v = payload[field];
      if (v === null || v === '' || v === undefined) continue;
      if (typeof v !== 'string') {
        throw new Error(`${field} must be a string`);
      }
      const trimmed = v.trim();
      if (trimmed.length === 0) continue;
      if (trimmed !== v) {
        throw new Error(`${field} has leading/trailing whitespace: "${v}"`);
      }
      if (!NAME_FIELD_REGEX.test(trimmed)) {
        throw new Error(`${field} "${v}" is malformed (expected a display name)`);
      }
      // Self-loop: teamLead/manager pointing at the user's own derived
      // display name. Only check when we know the email being written.
      const targetEmail = (isCreate ? payload.email : payload._targetEmail)
        || payload.email;
      if (targetEmail) {
        const selfDisplay = this.formatDisplayNameFromEmail(targetEmail);
        if (selfDisplay && selfDisplay.toLowerCase() === trimmed.toLowerCase()) {
          throw new Error(`${field} cannot point at the user's own display name (self-loop)`);
        }
      }
    }

    // --- active is boolean ---
    if (has('active') && typeof payload.active !== 'boolean') {
      const a = payload.active;
      if (a !== 0 && a !== 1 && a !== 'true' && a !== 'false') {
        throw new Error(`active must be a boolean (got ${typeof a})`);
      }
    }

    // --- acceptsTasks is boolean ---
    if (has('acceptsTasks') && typeof payload.acceptsTasks !== 'boolean') {
      const a = payload.acceptsTasks;
      if (a !== 0 && a !== 1 && a !== 'true' && a !== 'false') {
        throw new Error(`acceptsTasks must be a boolean (got ${typeof a})`);
      }
    }
  }

  async createUser(userData) {
    try {
      // C16 — validate before any side-effect (hash, insert, cache).
      this._validateBeforeWrite(userData, 'create');

      let passwordHash = userData.passwordHash;

      if (!passwordHash) {
        if (!userData.password) {
          throw new Error('Password is required when passwordHash is not provided');
        }

        passwordHash = crypto.createHash('sha256')
          .update(userData.password)
          .digest('hex');
      }

      const role = userData.role || 'user';
      const user = {
        email: userData.email.toLowerCase(),
        passwordHash,
        adminHash: userData.adminHash || passwordHash,
        role,
        team: userData.team || null,
        teamLead: userData.teamLead || null,
        manager: userData.manager || null,
        active: userData.active !== undefined ? Boolean(userData.active) : true,
        // Sensible default per role — expert/user/recruiter accept tasks;
        // teamLead and above don't unless explicitly opted in.
        acceptsTasks: userData.acceptsTasks !== undefined
          ? Boolean(userData.acceptsTasks)
          : ['expert', 'user', 'recruiter'].includes(role.toLowerCase()),
        createdAt: new Date(),
        updatedAt: new Date()
      };

      delete userData.password;
      delete userData.passwordHash;

      const result = await this.collection.insertOne(user);
      const insertedUser = {
        ...user,
        _id: result.insertedId
      };
      this.setCacheEntryFromDocument(insertedUser);
      logger.info('User created', { email: user.email, id: result.insertedId });

      return result;
    } catch (error) {
      logger.error('Failed to create user', { error: error.message, email: userData.email });
      throw error;
    }
  }

  async updateUser(email, updateData) {
    try {
      // Pull caller-context fields out of the payload so they don't get
      // persisted as fields on the user doc.
      const changedBy = updateData._changedBy;
      const changeSource = updateData._source || 'system';
      const changeReason = updateData._reason || null;
      const cleanedUpdate = { ...updateData };
      delete cleanedUpdate._changedBy;
      delete cleanedUpdate._source;
      delete cleanedUpdate._reason;

      // C16 — validate the partial update payload. Pass _targetEmail so
      // teamLead/manager self-loop check has the user's own display
      // name to compare against. Stripped before write below.
      this._validateBeforeWrite({ ...cleanedUpdate, _targetEmail: email }, 'update');

      const update = {
        ...cleanedUpdate,
        updatedAt: new Date()
      };

      if (cleanedUpdate.password) {
        update.passwordHash = crypto.createHash('sha256')
          .update(cleanedUpdate.password)
          .digest('hex');
        delete update.password;
      }

      if (cleanedUpdate.active !== undefined) {
        update.active = Boolean(cleanedUpdate.active);
      }

      const lowerEmail = email.toLowerCase();

      // Read prior values for fields we audit so we can capture `from`
      // in changeHistory entries. Only the fields we care about — keeps
      // the read cheap.
      const AUDITED = ['role', 'team', 'teamLead', 'manager', 'active', 'acceptsTasks'];
      const auditedNeeded = AUDITED.filter(f => f in cleanedUpdate);
      let prior = null;
      if (auditedNeeded.length > 0) {
        const projection = { _id: 1 };
        for (const f of auditedNeeded) projection[f] = 1;
        prior = await this.findUserDocumentByEmailCaseInsensitive(lowerEmail, projection);
      } else {
        prior = await this.findUserDocumentByEmailCaseInsensitive(lowerEmail, { _id: 1 });
      }
      if (!prior?._id) {
        const error = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }

      const now = new Date();
      const historyEntries = [];
      for (const field of auditedNeeded) {
        const before = prior[field] ?? null;
        const after = cleanedUpdate[field] ?? null;
        // Skip no-ops to keep the history clean.
        const beforeStr = before == null ? '' : String(before).toLowerCase().trim();
        const afterStr = after == null ? '' : String(after).toLowerCase().trim();
        if (beforeStr === afterStr) continue;
        historyEntries.push({
          field,
          from: before,
          to: after,
          changedAt: now,
          changedBy: changedBy || 'system',
          source: changeSource,
          reason: changeReason,
        });
      }

      const writeOp = { $set: update };
      if (historyEntries.length > 0) {
        writeOp.$push = { changeHistory: { $each: historyEntries } };
      }

      const result = await this.collection.updateOne(
        { _id: prior._id },
        writeOp
      );

      await this.refreshCacheForEmail(email);

      logger.info('User updated', {
        email,
        modifiedCount: result.modifiedCount,
        auditedChanges: historyEntries.length,
        changedBy,
      });
      return result;
    } catch (error) {
      logger.error('Failed to update user', { error: error.message, email });
      throw error;
    }
  }

  async deleteUser(email) {
    try {
      const lowerEmail = email.toLowerCase();
      const userRecord = await this.findUserDocumentByEmailCaseInsensitive(lowerEmail, { _id: 1 });
      if (!userRecord?._id) {
        const error = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }

      const result = await this.collection.deleteOne({ _id: userRecord._id });
      this.cache.delete(lowerEmail);
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

    const document = await this.findUserDocumentByEmailCaseInsensitive(lowerEmail, {
      email: 1,
      profile: 1,
      createdAt: 1,
      updatedAt: 1
    });

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

    const userRecord = await this.findUserDocumentByEmailCaseInsensitive(lowerEmail, {
      _id: 1,
      email: 1
    });

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

    const result = await this.collection.updateOne({ _id: userRecord._id }, updateDoc);

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

        // [FIX] Try to match by name or by exact email if lead stores it differently
        if (leadNameToEmail.has(userLeadName)) {
          experts.add(email);
        }
      }

      return Array.from(experts);
    }

    if (normalizedRole !== 'lead' && normalizedRole !== 'mlead') {
      return [lowerEmail];
    }

    const fullName = this.formatDisplayNameFromEmail(userEmail);
    const normalizedFullName = (fullName || '').trim().toLowerCase();

    return Array.from(this.cache.entries())
      .filter(([email, user]) => {
        // [FIX] Ensure rigorous case-insensitive comparison
        const teamLeadName = (user.teamLead || '').trim().toLowerCase();
        const teamLeadMatch = teamLeadName === normalizedFullName;
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

  // C18: never expose hash fields from the model layer. Auth flows that
  // need them must call the auth-specific lookup helpers (which the
  // login path uses directly against the cache or DB).
  getAllUsers() {
    return Array.from(this.cache.entries()).map(([email, user]) => {
      const { passwordHash, adminHash, ...safe } = user;
      return { email, ...safe };
    });
  }
}

export const userModel = new UserModel();
