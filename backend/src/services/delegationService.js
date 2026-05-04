// C19 — time-bound delegation (Share). Phase 1: schema + service skeleton.
//
// See docs/superpowers/specs/2026-05-04-c19-share-transfer-design.md for the
// locked design. This file ships the foundation:
//   - userDelegations collection accessor + indexes
//   - grant() with share-matrix validation
//   - revoke() with audit fields
//   - listActiveForUser() — hot read path used by BFS unions in phase 2
//   - listActiveForOwner() — for the "my active shares" UI panel
//   - sweepExpired() — TTL housekeeping called by the cron in phase 5
//
// Notifications, transfer, BFS union, REST routes, UI all come in later
// phases. This phase intentionally has zero callers — it's the building
// block.

import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { userModel } from '../models/User.js';
import { logger } from '../utils/logger.js';
import { toLegacyRole } from '../utils/roleAliases.js';

const COLLECTION = 'userDelegations';

// Locked TTLs from the spec. Frontend dropdown must match this exactly.
const VALID_TTL_DAYS = new Set([7, 15, 30, 180]);
const FOREVER = null;

// Share matrix — locked in the audit's C19 card. Same role-level + same
// team. `manager` is the only role allowed to share cross-team.
//
// Returns { ok: true } or { ok: false, reason: string }.
const validateShareMatrix = ({ ownerRole, ownerTeam, delegateRole, delegateTeam }) => {
  const oR = toLegacyRole(ownerRole, ownerTeam);
  const dR = toLegacyRole(delegateRole, delegateTeam);
  if (!oR || !dR) {
    return { ok: false, reason: 'role missing on owner or delegate' };
  }
  if (oR === 'admin') return { ok: true }; // admin can share to anyone
  if (oR !== dR) {
    return { ok: false, reason: `share requires same role level — owner is ${oR}, delegate is ${dR}` };
  }
  // manager: cross-team allowed (Tushar case)
  if (oR === 'mm') return { ok: true };
  // everyone else: same team required
  if ((ownerTeam || null) !== (delegateTeam || null)) {
    return { ok: false, reason: `${oR} can only share within the same team (owner=${ownerTeam}, delegate=${delegateTeam})` };
  }
  return { ok: true };
};

const computeExpiresAt = (ttlDays) => {
  if (ttlDays === FOREVER || ttlDays === null || ttlDays === undefined) return null;
  if (typeof ttlDays !== 'number' || !VALID_TTL_DAYS.has(ttlDays)) {
    throw new Error(`ttlDays must be one of: 7, 15, 30, 180, or null (forever) — got ${ttlDays}`);
  }
  const ms = ttlDays * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
};

class DelegationService {
  collection() {
    const col = database.getCollection(COLLECTION);
    if (!col) throw new Error('database not ready');
    return col;
  }

  // Idempotent — safe to call on every boot. Builds the indexes named
  // in the spec. Hot read path is { delegateEmail, expiresAt, revokedAt }.
  async ensureIndexes() {
    try {
      const col = this.collection();
      await col.createIndex(
        { delegateEmail: 1, expiresAt: 1, revokedAt: 1 },
        { name: 'delegate_active_lookup' }
      );
      await col.createIndex(
        { ownerEmail: 1, revokedAt: 1 },
        { name: 'owner_active_lookup' }
      );
      await col.createIndex(
        { expiresAt: 1, revokedAt: 1 },
        { name: 'sweep_expired' }
      );
      logger.info('delegationService: indexes ensured');
    } catch (err) {
      logger.error('delegationService: ensureIndexes failed', { error: err.message });
      throw err;
    }
  }

  /**
   * Grant a new delegation.
   *
   * @param actor      { email, role, team } — who is performing the grant.
   *                   Must equal ownerEmail (you grant from your own
   *                   subtree only) OR be admin.
   * @param input      { ownerEmail, delegateEmail, scope, subjectEmails?,
   *                     subtreeRootEmail?, ttlDays, reason }
   * @returns inserted delegation document
   */
  async grant(actor, input) {
    const {
      ownerEmail, delegateEmail, scope,
      subjectEmails = [], subtreeRootEmail = null,
      ttlDays, reason = '',
    } = input || {};

    if (!actor?.email) throw new Error('actor required');
    if (!ownerEmail) throw new Error('ownerEmail required');
    if (!delegateEmail) throw new Error('delegateEmail required');
    if (ownerEmail.toLowerCase() === delegateEmail.toLowerCase()) {
      throw new Error('cannot delegate to yourself');
    }
    if (!['specific', 'subtree'].includes(scope)) {
      throw new Error(`scope must be 'specific' or 'subtree', got: ${scope}`);
    }
    if (scope === 'specific' && (!Array.isArray(subjectEmails) || subjectEmails.length === 0)) {
      throw new Error('scope=specific requires at least one subjectEmail');
    }
    if (scope === 'subtree' && !subtreeRootEmail) {
      throw new Error('scope=subtree requires subtreeRootEmail');
    }

    // Authority: only the owner themselves or admin can grant from a
    // given subtree. Admin can grant anything.
    const actorRole = toLegacyRole(actor.role, actor.team);
    if (actorRole !== 'admin' && actor.email.toLowerCase() !== ownerEmail.toLowerCase()) {
      throw new Error('only the owner or an admin can grant a delegation');
    }

    const owner = await Promise.resolve(userModel.getUserByEmail(ownerEmail));
    const delegate = await Promise.resolve(userModel.getUserByEmail(delegateEmail));
    if (!owner) throw new Error(`owner ${ownerEmail} not found`);
    if (!delegate) throw new Error(`delegate ${delegateEmail} not found`);
    if (owner.active === false) throw new Error('owner is inactive');
    if (delegate.active === false) throw new Error('delegate is inactive');

    const matrix = validateShareMatrix({
      ownerRole: owner.role, ownerTeam: owner.team,
      delegateRole: delegate.role, delegateTeam: delegate.team,
    });
    if (!matrix.ok) {
      throw new Error(`share matrix violation: ${matrix.reason}`);
    }

    const expiresAt = computeExpiresAt(ttlDays);
    const now = new Date();

    const doc = {
      ownerEmail: ownerEmail.toLowerCase(),
      delegateEmail: delegateEmail.toLowerCase(),
      scope,
      subjectEmails: scope === 'specific'
        ? subjectEmails.map((e) => (e || '').toString().toLowerCase()).filter(Boolean)
        : [],
      subtreeRootEmail: scope === 'subtree' ? (subtreeRootEmail || '').toLowerCase() : null,
      grantedAt: now,
      grantedBy: actor.email.toLowerCase(),
      expiresAt,
      revokedAt: null,
      revokedBy: null,
      reason: (reason || '').toString().slice(0, 500),
      source: actor.email.toLowerCase() === 'system' ? 'system' : 'manual-ui',
    };

    const result = await this.collection().insertOne(doc);
    logger.info('delegation granted', {
      id: result.insertedId.toString(),
      ownerEmail: doc.ownerEmail, delegateEmail: doc.delegateEmail,
      scope, expiresAt, grantedBy: doc.grantedBy,
    });
    return { _id: result.insertedId, ...doc };
  }

  /**
   * Revoke a delegation. Owner of the share or admin can revoke.
   * Idempotent — revoking an already-revoked delegation is a no-op.
   */
  async revoke(actor, delegationId, reason = '') {
    if (!actor?.email) throw new Error('actor required');
    let oid;
    try { oid = new ObjectId(delegationId); }
    catch { throw new Error('invalid delegationId'); }

    const existing = await this.collection().findOne({ _id: oid });
    if (!existing) throw new Error('delegation not found');
    if (existing.revokedAt) {
      // Idempotent; return the existing record.
      return existing;
    }

    const actorRole = toLegacyRole(actor.role, actor.team);
    const isOwner = actor.email.toLowerCase() === existing.ownerEmail;
    if (actorRole !== 'admin' && !isOwner) {
      throw new Error('only the owner or admin can revoke');
    }

    const now = new Date();
    const update = {
      $set: {
        revokedAt: now,
        revokedBy: actor.email.toLowerCase(),
        revokeReason: (reason || '').toString().slice(0, 500),
      },
    };
    await this.collection().updateOne({ _id: oid }, update);
    logger.info('delegation revoked', {
      id: delegationId, by: actor.email, reason,
    });
    return { ...existing, ...update.$set };
  }

  /**
   * Hot read path. Returns active grants where the given email is the
   * delegate. "Active" = expiresAt is null or in the future, AND
   * revokedAt is null. Used by BFS unions in phase 2.
   */
  async listActiveForUser(delegateEmail) {
    const now = new Date();
    const cursor = this.collection().find({
      delegateEmail: (delegateEmail || '').toLowerCase(),
      revokedAt: null,
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } },
      ],
    });
    return cursor.toArray();
  }

  /**
   * Owner's "my active shares" panel.
   */
  async listActiveForOwner(ownerEmail) {
    const now = new Date();
    const cursor = this.collection().find({
      ownerEmail: (ownerEmail || '').toLowerCase(),
      revokedAt: null,
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } },
      ],
    });
    return cursor.toArray();
  }

  /**
   * Sweep cron entry point. Marks every row whose expiresAt has passed
   * and revokedAt is still null as expired. Returns the count.
   */
  async sweepExpired() {
    const now = new Date();
    const result = await this.collection().updateMany(
      {
        revokedAt: null,
        expiresAt: { $ne: null, $lte: now },
      },
      {
        $set: {
          revokedAt: now,
          revokedBy: 'system:expiry',
        },
      },
    );
    if (result.modifiedCount > 0) {
      logger.info('delegation sweep — expired', { count: result.modifiedCount });
    }
    return result.modifiedCount;
  }
}

export const delegationService = new DelegationService();
export const _testHelpers = { validateShareMatrix, computeExpiresAt, VALID_TTL_DAYS };
