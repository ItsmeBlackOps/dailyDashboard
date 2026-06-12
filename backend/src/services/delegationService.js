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
import { notificationService } from './notificationService.js';
import { logger } from '../utils/logger.js';
import { toLegacyRole } from '../utils/roleAliases.js';

// C19 phase 5 — notification helpers. Each delegation event fans out
// in-app notifications via the existing notifications collection.
// Q5 lock: full transparency — owner, delegate, AND each subject get
// pinged on grant / revoke / expiry. Transfer notifies source teamLead,
// destination teamLead, the moved person, and crosses-boundary cases
// also notify the source's manager.
const notifyDelegationGranted = async (doc) => {
  const { ownerEmail, delegateEmail, scope, subjectEmails, subtreeRootEmail, expiresAt, reason } = doc;
  const ttlLabel = expiresAt
    ? `expires ${new Date(expiresAt).toLocaleDateString()}`
    : 'no expiry (forever)';
  const subjects = scope === 'specific' ? subjectEmails : [subtreeRootEmail];
  await Promise.all([
    notificationService.createNotification(ownerEmail, {
      type: 'info',
      title: 'Share granted',
      description: `You shared ${scope === 'subtree' ? 'your subtree' : `${subjects.length} subordinate(s)`} with ${delegateEmail}. ${ttlLabel}.${reason ? ' Reason: ' + reason : ''}`,
    }),
    notificationService.createNotification(delegateEmail, {
      type: 'info',
      title: 'New shared access',
      description: `${ownerEmail} shared ${scope === 'subtree' ? 'their subtree' : `${subjects.length} subordinate(s)`} with you. ${ttlLabel}.`,
    }),
    notificationService.broadcastToWatchers(subjects.filter(Boolean), {
      type: 'info',
      title: 'New manager visibility',
      description: `${delegateEmail} has been granted shared access to manage you (granted by ${ownerEmail}). ${ttlLabel}.`,
    }),
  ]).catch((err) => logger.warn('notifyDelegationGranted partial failure', { error: err.message }));
};

const notifyDelegationRevoked = async (doc, isExpiry = false) => {
  const { ownerEmail, delegateEmail, scope, subjectEmails, subtreeRootEmail } = doc;
  const subjects = scope === 'specific' ? subjectEmails : [subtreeRootEmail];
  const verb = isExpiry ? 'expired' : 'revoked';
  await Promise.all([
    notificationService.createNotification(ownerEmail, {
      type: 'info',
      title: `Share ${verb}`,
      description: `Your share of ${scope === 'subtree' ? 'your subtree' : `${subjects.length} subordinate(s)`} with ${delegateEmail} has ${verb}.`,
    }),
    notificationService.createNotification(delegateEmail, {
      type: 'info',
      title: `Shared access ${verb}`,
      description: `Your access to ${ownerEmail}'s ${scope === 'subtree' ? 'subtree' : `${subjects.length} subordinate(s)`} has ${verb}.`,
    }),
    notificationService.broadcastToWatchers(subjects.filter(Boolean), {
      type: 'info',
      title: 'Manager visibility ended',
      description: `${delegateEmail} no longer has shared access to manage you (${verb}).`,
    }),
  ]).catch((err) => logger.warn('notifyDelegationRevoked partial failure', { error: err.message }));
};

const notifyTransfer = async ({ subjectEmail, fromName, toName, actorEmail }) => {
  // Q5 lock: notify subject (their reporting line changed) + both leads.
  await Promise.all([
    notificationService.createNotification(subjectEmail, {
      type: 'info',
      title: 'Reporting line changed',
      description: `Your teamLead changed${fromName ? ' from ' + fromName : ''} to ${toName}. Performed by ${actorEmail}.`,
    }),
    fromName ? notificationService.broadcastToWatchers(
      [], // best-effort: we don't always have the source teamLead's email here
      { type: 'info', title: `${subjectEmail} transferred away`, description: `Moved to ${toName} by ${actorEmail}.` }
    ) : Promise.resolve(),
    notificationService.broadcastToWatchers(
      [],
      { type: 'info', title: `${subjectEmail} transferred to your team`, description: `Previously under ${fromName || '(none)'}. Performed by ${actorEmail}.` }
    ),
  ]).catch((err) => logger.warn('notifyTransfer partial failure', { error: err.message }));
};

// Human description of what a delegation covers (notifications + logs).
const describeScope = (doc) => {
  if (doc.scope === 'tasks') {
    const n = (doc.taskIds || []).length;
    return `${n} task${n === 1 ? '' : 's'}`;
  }
  if (doc.scope === 'day') return `the whole day ${doc.dayDate}`;
  if (doc.scope === 'subtree') {
    return doc.subtreeRootEmail === doc.ownerEmail
      ? `${doc.ownerEmail}'s dashboard`
      : `the subtree under ${doc.subtreeRootEmail}`;
  }
  return `${(doc.subjectEmails || []).length} subordinate(s)`;
};

const COLLECTION = 'userDelegations';

// Locked TTLs from the spec. Frontend dropdown must match this exactly.
const VALID_TTL_DAYS = new Set([7, 15, 30, 180]);
const FOREVER = null;

// Delegation v2 — granular scopes + approval flow (2026-06-12 spec).
const VALID_SCOPES = ['specific', 'subtree', 'tasks', 'day'];
const EXPERT_ROLES = new Set(['user', 'expert']);
const LEAD_TIER = new Set(['lead', 'mlead', 'am', 'mam']);
const MAX_TASK_IDS = 10;
const MAX_WINDOW_DAYS = 30;
const TASK_GRACE_MS = 24 * 60 * 60 * 1000; // hand-off lives 24h past the last task
const DAY_GRACE_MS = 28 * 60 * 60 * 1000;  // day grant: end of UTC day + EST slack

const normName = (v) => (v || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');

// Resolve a user's teamLead display name ("Anusree Vasudevan") to that
// lead's email, matching the BFS convention that display names derive
// from email local parts. Returns null when no active user matches.
const resolveTeamLeadEmail = async (user) => {
  const wanted = normName(user?.teamLead);
  if (!wanted) return null;
  const usersCol = database.getCollection('users');
  if (!usersCol) return null;
  const { userService } = await import('./userService.js');
  const rows = await usersCol
    .find({ active: { $ne: false } }, { projection: { email: 1 } })
    .toArray();
  for (const u of rows) {
    const display = normName(userService.deriveDisplayNameFromEmail(u.email));
    if (display && display === wanted) return (u.email || '').toLowerCase();
  }
  return null;
};

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
      taskIds = [], dayDate = null,
      startsAt = null, endsAt = null,
      ttlDays, reason = '',
    } = input || {};

    if (!actor?.email) throw new Error('actor required');
    if (!ownerEmail) throw new Error('ownerEmail required');
    if (!delegateEmail) throw new Error('delegateEmail required');
    if (ownerEmail.toLowerCase() === delegateEmail.toLowerCase()) {
      throw new Error('cannot delegate to yourself');
    }
    if (!VALID_SCOPES.includes(scope)) {
      throw new Error(`scope must be one of ${VALID_SCOPES.join('/')}, got: ${scope}`);
    }
    if (scope === 'specific' && (!Array.isArray(subjectEmails) || subjectEmails.length === 0)) {
      throw new Error('scope=specific requires at least one subjectEmail');
    }
    if (scope === 'subtree' && !subtreeRootEmail) {
      throw new Error('scope=subtree requires subtreeRootEmail');
    }
    let taskOids = [];
    if (scope === 'tasks') {
      if (!Array.isArray(taskIds) || taskIds.length === 0) {
        throw new Error('scope=tasks requires at least one taskId');
      }
      if (taskIds.length > MAX_TASK_IDS) {
        throw new Error(`scope=tasks supports at most ${MAX_TASK_IDS} tasks — use a day or dashboard share instead`);
      }
      try {
        taskOids = taskIds.map((id) => new ObjectId(id));
      } catch {
        throw new Error('invalid taskId in taskIds');
      }
    }
    if (scope === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(dayDate || '')) {
      throw new Error('scope=day requires dayDate as YYYY-MM-DD');
    }

    const ownerLower = ownerEmail.toLowerCase();
    const actorEmail = actor.email.toLowerCase();
    const actorRole = toLegacyRole(actor.role, actor.team);

    const owner = await Promise.resolve(userModel.getUserByEmail(ownerEmail));
    const delegate = await Promise.resolve(userModel.getUserByEmail(delegateEmail));
    if (!owner) throw new Error(`owner ${ownerEmail} not found`);
    if (!delegate) throw new Error(`delegate ${delegateEmail} not found`);
    if (owner.active === false) throw new Error('owner is inactive');
    if (delegate.active === false) throw new Error('delegate is inactive');

    // Authority: the owner themselves, an admin — or, for the coverage
    // scopes, the owner's own team lead acting on their report's behalf
    // (the "lead hands off directly" path; it skips the approval queue).
    let onBehalfLead = false;
    if (actorRole !== 'admin' && actorEmail !== ownerLower) {
      const { userService } = await import('./userService.js');
      const actorDisplay = normName(userService.deriveDisplayNameFromEmail(actorEmail));
      const leadOwnsReport =
        LEAD_TIER.has(actorRole) &&
        ['tasks', 'day', 'subtree'].includes(scope) &&
        actorDisplay &&
        normName(owner.teamLead) === actorDisplay;
      if (!leadOwnsReport) {
        throw new Error('only the owner, their team lead, or an admin can grant a delegation');
      }
      onBehalfLead = true;
    }

    const matrix = validateShareMatrix({
      ownerRole: owner.role, ownerTeam: owner.team,
      delegateRole: delegate.role, delegateTeam: delegate.team,
    });
    if (!matrix.ok) {
      throw new Error(`share matrix violation: ${matrix.reason}`);
    }

    // Expert authors get the coverage scopes only, and a subtree share
    // must be their own dashboard (root = self).
    const ownerRole = toLegacyRole(owner.role, owner.team);
    const ownerIsExpert = EXPERT_ROLES.has(ownerRole);
    if (ownerIsExpert) {
      if (!['tasks', 'day', 'subtree'].includes(scope)) {
        throw new Error('experts can share tasks, a day, or their own dashboard');
      }
      if (scope === 'subtree' && (subtreeRootEmail || '').toLowerCase() !== ownerLower) {
        throw new Error('experts can only share their own dashboard (subtree root must be themselves)');
      }
    }

    // Expiry per scope. Coverage scopes derive absolute windows, so a
    // slow approval never eats into the coverage itself.
    const now = new Date();
    let computedStartsAt = null;
    let expiresAt;
    if (scope === 'tasks') {
      const taskCol = database.getCollection('taskBody');
      if (!taskCol) throw new Error('database not ready');
      const rows = await taskCol
        .find({ _id: { $in: taskOids } }, { projection: { interviewEndsAt: 1, interviewStartAt: 1, assignedTo: 1 } })
        .toArray();
      if (rows.length !== taskOids.length) throw new Error('one or more taskIds not found');
      const notOwned = rows.find((r) => (r.assignedTo || '').toLowerCase() !== ownerLower);
      if (notOwned) throw new Error('tasks can only be handed off by the expert they are assigned to');
      const ends = rows.map((r) => new Date(r.interviewEndsAt || r.interviewStartAt || now).getTime());
      expiresAt = new Date(Math.max(...ends, now.getTime()) + TASK_GRACE_MS);
    } else if (scope === 'day') {
      expiresAt = new Date(new Date(`${dayDate}T00:00:00Z`).getTime() + 24 * 3600 * 1000 + DAY_GRACE_MS);
      if (expiresAt <= now) throw new Error('dayDate is already in the past');
    } else if (ownerIsExpert) {
      // dashboard window — explicit dates, max 30 days, may start later
      if (!endsAt) throw new Error('a dashboard share needs an end date (endsAt)');
      const sDate = startsAt ? new Date(startsAt) : now;
      const eDate = new Date(endsAt);
      if (Number.isNaN(sDate.getTime()) || Number.isNaN(eDate.getTime())) {
        throw new Error('invalid startsAt/endsAt');
      }
      if (eDate <= sDate) throw new Error('endsAt must be after startsAt');
      if (eDate.getTime() - sDate.getTime() > MAX_WINDOW_DAYS * 86400 * 1000) {
        throw new Error(`a dashboard share cannot exceed ${MAX_WINDOW_DAYS} days`);
      }
      computedStartsAt = startsAt ? sDate : null;
      expiresAt = eDate;
    } else {
      expiresAt = computeExpiresAt(ttlDays);
    }

    // Approval: expert-authored requests go to the expert's own team
    // lead. Lead-on-behalf and admin grants activate immediately.
    let status = 'active';
    let approverEmail = null;
    if (ownerIsExpert && !onBehalfLead && actorRole !== 'admin') {
      approverEmail = await resolveTeamLeadEmail(owner);
      if (!approverEmail) {
        throw new Error(`cannot resolve a team lead to approve this request (teamLead: ${owner.teamLead || 'none'})`);
      }
      status = 'pending';
    }

    const doc = {
      ownerEmail: ownerLower,
      delegateEmail: delegateEmail.toLowerCase(),
      scope,
      subjectEmails: scope === 'specific'
        ? subjectEmails.map((e) => (e || '').toString().toLowerCase()).filter(Boolean)
        : [],
      subtreeRootEmail: scope === 'subtree' ? (subtreeRootEmail || '').toLowerCase() : null,
      taskIds: scope === 'tasks' ? taskOids.map((o) => o.toString()) : [],
      dayDate: scope === 'day' ? dayDate : null,
      startsAt: computedStartsAt,
      status,
      approverEmail,
      approvedAt: null,
      approvedBy: null,
      rejectedAt: null,
      rejectedBy: null,
      rejectNote: null,
      grantedAt: now,
      grantedBy: actorEmail,
      expiresAt,
      revokedAt: null,
      revokedBy: null,
      reason: (reason || '').toString().slice(0, 500),
      source: actorEmail === 'system' ? 'system' : 'manual-ui',
    };

    const result = await this.collection().insertOne(doc);
    logger.info('delegation granted', {
      id: result.insertedId.toString(),
      ownerEmail: doc.ownerEmail, delegateEmail: doc.delegateEmail,
      scope, status, expiresAt, grantedBy: doc.grantedBy,
    });
    if (status === 'pending') {
      notificationService.createNotification(approverEmail, {
        type: 'info',
        title: 'Delegation approval needed',
        description: `${doc.ownerEmail} asked ${doc.delegateEmail} to cover ${describeScope(doc)}. Review it on the Delegations page.`,
        link: '/delegations',
      }).catch(() => {});
      notificationService.createNotification(doc.ownerEmail, {
        type: 'info',
        title: 'Request sent for approval',
        description: `Your coverage request (${describeScope(doc)} → ${doc.delegateEmail}) is waiting for ${approverEmail}.`,
      }).catch(() => {});
    } else {
      // Fire-and-forget — don't fail the grant on notification errors.
      notifyDelegationGranted(doc).catch(() => {});
    }
    return { _id: result.insertedId, ...doc };
  }

  /**
   * Approve a pending (expert-authored) delegation. Only the assigned
   * approver — the requesting expert's team lead — or an admin.
   */
  async approveRequest(actor, delegationId) {
    if (!actor?.email) throw new Error('actor required');
    let oid;
    try { oid = new ObjectId(delegationId); }
    catch { throw new Error('invalid delegationId'); }
    const doc = await this.collection().findOne({ _id: oid });
    if (!doc) throw new Error('delegation not found');
    if (doc.status !== 'pending') return doc; // idempotent
    const actorRole = toLegacyRole(actor.role, actor.team);
    if (actorRole !== 'admin' && actor.email.toLowerCase() !== doc.approverEmail) {
      throw new Error('only the assigned approver or an admin can approve');
    }
    const now = new Date();
    await this.collection().updateOne(
      { _id: oid, status: 'pending' },
      { $set: { status: 'active', approvedAt: now, approvedBy: actor.email.toLowerCase() } }
    );
    logger.info('delegation approved', { id: delegationId, by: actor.email });
    const updated = { ...doc, status: 'active', approvedAt: now, approvedBy: actor.email.toLowerCase() };
    Promise.all([
      notificationService.createNotification(doc.ownerEmail, {
        type: 'info',
        title: 'Coverage approved',
        description: `${actor.email} approved: ${doc.delegateEmail} now covers ${describeScope(doc)}.`,
      }),
      notificationService.createNotification(doc.delegateEmail, {
        type: 'info',
        title: 'You are covering',
        description: `${actor.email} approved ${doc.ownerEmail}'s request — you now cover ${describeScope(doc)}.`,
        link: '/tasks',
      }),
    ]).catch(() => {});
    return updated;
  }

  /** Reject a pending delegation (assigned approver or admin). */
  async rejectRequest(actor, delegationId, note = '') {
    if (!actor?.email) throw new Error('actor required');
    let oid;
    try { oid = new ObjectId(delegationId); }
    catch { throw new Error('invalid delegationId'); }
    const doc = await this.collection().findOne({ _id: oid });
    if (!doc) throw new Error('delegation not found');
    if (doc.status !== 'pending') return doc; // idempotent
    const actorRole = toLegacyRole(actor.role, actor.team);
    if (actorRole !== 'admin' && actor.email.toLowerCase() !== doc.approverEmail) {
      throw new Error('only the assigned approver or an admin can reject');
    }
    const now = new Date();
    const fields = {
      status: 'rejected',
      rejectedAt: now,
      rejectedBy: actor.email.toLowerCase(),
      rejectNote: (note || '').toString().slice(0, 500),
    };
    await this.collection().updateOne({ _id: oid, status: 'pending' }, { $set: fields });
    logger.info('delegation rejected', { id: delegationId, by: actor.email });
    notificationService.createNotification(doc.ownerEmail, {
      type: 'info',
      title: 'Coverage request declined',
      description: `${actor.email} declined your request for ${doc.delegateEmail} to cover ${describeScope(doc)}.${fields.rejectNote ? ' Note: ' + fields.rejectNote : ''}`,
    }).catch(() => {});
    return { ...doc, ...fields };
  }

  /** Pending requests waiting on this approver (the lead's inbox). */
  async listPendingForApprover(approverEmail) {
    return this.collection()
      .find({ status: 'pending', approverEmail: (approverEmail || '').toLowerCase() })
      .toArray();
  }

  /** Pending requests this owner has filed (for "my requests" chips). */
  async listPendingForOwner(ownerEmail) {
    return this.collection()
      .find({ status: 'pending', ownerEmail: (ownerEmail || '').toLowerCase() })
      .toArray();
  }

  /**
   * Server-computed dropdown options for the Delegations UI — produced
   * by the SAME rules that validate writes, so the client can never
   * offer an illegal choice. Active users only.
   */
  async eligibleOptions(actor) {
    if (!actor?.email) throw new Error('actor required');
    const usersCol = database.getCollection('users');
    if (!usersCol) throw new Error('database not ready');
    const { userService } = await import('./userService.js');
    const me = (actor.email || '').toLowerCase();
    const all = await usersCol
      .find({ active: { $ne: false } }, { projection: { email: 1, role: 1, team: 1, teamLead: 1 } })
      .toArray();
    const meDoc = all.find((u) => (u.email || '').toLowerCase() === me)
      || { email: me, role: actor.role, team: actor.team || null, teamLead: null };
    const myRole = toLegacyRole(meDoc.role, meDoc.team);
    const myTeam = meDoc.team || null;
    const myDisplay = normName(userService.deriveDisplayNameFromEmail(me));
    const legacyOf = (u) => toLegacyRole(u.role, u.team);
    const slim = (u) => ({
      email: (u.email || '').toLowerCase(),
      role: legacyOf(u),
      team: u.team || null,
      teamLead: u.teamLead || null,
    });
    const byEmail = (a, b) => a.email.localeCompare(b.email);

    const delegates = all
      .filter((u) => (u.email || '').toLowerCase() !== me)
      .filter((u) => validateShareMatrix({
        ownerRole: meDoc.role, ownerTeam: meDoc.team,
        delegateRole: u.role, delegateTeam: u.team,
      }).ok)
      .map(slim)
      .sort(byEmail);

    const myPeople = myDisplay
      ? all.filter((u) => normName(u.teamLead) === myDisplay).map(slim).sort(byEmail)
      : [];

    const deptExperts = all
      .filter((u) => EXPERT_ROLES.has(legacyOf(u)))
      .filter((u) => (u.email || '').toLowerCase() !== me)
      .filter((u) => (myTeam ? (u.team || null) === myTeam : true))
      .map((u) => ({ ...slim(u), mine: myDisplay ? normName(u.teamLead) === myDisplay : false }))
      .sort(byEmail);

    const transferTargets = all
      .filter((u) => (u.email || '').toLowerCase() !== me)
      .filter((u) => legacyOf(u) === myRole && LEAD_TIER.has(myRole))
      .filter((u) => (u.team || null) === myTeam)
      .map((u) => ({
        email: (u.email || '').toLowerCase(),
        displayName: userService.formatNameValue
          ? userService.formatNameValue(userService.deriveDisplayNameFromEmail(u.email))
          : userService.deriveDisplayNameFromEmail(u.email),
      }))
      .sort(byEmail);

    return { actorRole: myRole, actorTeam: myTeam, delegates, myPeople, deptExperts, transferTargets };
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
    notifyDelegationRevoked(existing, false).catch(() => {});
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
      // pending/rejected grant NOTHING; legacy docs without status pass.
      status: { $nin: ['pending', 'rejected'] },
      $and: [
        { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
        // future-dated windows stay dormant until startsAt
        { $or: [{ startsAt: null }, { startsAt: { $exists: false } }, { startsAt: { $lte: now } }] },
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
      status: { $nin: ['pending', 'rejected'] },
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } },
      ],
    });
    return cursor.toArray();
  }

  /**
   * Transfer — one-shot lateral move of a subject's teamLead to a new
   * one. Per the locked Q3, every layer can perform a transfer scoped
   * to their own authority:
   *
   *   admin            anywhere
   *   manager          anyone in their team (cross-team only via admin)
   *   assistantManager anyone in their subtree
   *   teamLead         one of their own direct reports → a peer teamLead
   *                    in the same assistantManager subtree
   *
   * Source loses access immediately, destination gains immediately.
   * Audited via the existing User.updateUser changeHistory pipeline.
   *
   * @param actor          { email, role, team }
   * @param input          { subjectEmail, toTeamLeadDisplayName, reason }
   *                       The destination is identified by display name
   *                       to match the existing teamLead string field
   *                       (C9 validator gates the (role, teamLead) combo).
   */
  async transfer(actor, input) {
    if (!actor?.email) throw new Error('actor required');
    const { subjectEmail, toTeamLeadDisplayName, reason = '' } = input || {};
    if (!subjectEmail) throw new Error('subjectEmail required');
    if (!toTeamLeadDisplayName) throw new Error('toTeamLeadDisplayName required');

    // Lazy-import to avoid circular deps with userService.
    const { userService } = await import('./userService.js');
    const { userModel } = await import('../models/User.js');

    const subject = await Promise.resolve(userModel.getUserByEmail(subjectEmail));
    if (!subject) throw new Error(`subject ${subjectEmail} not found`);
    if (subject.active === false) throw new Error('subject is inactive');

    // Authority check — actor must be admin OR have the subject in their
    // hierarchy (own subtree or via an active delegation).
    const actorRole = toLegacyRole(actor.role, actor.team);
    if (actorRole !== 'admin') {
      const inScope = await userService.isUserInRequesterHierarchy(actor, subjectEmail);
      if (!inScope) {
        throw new Error('subject is not in your authority');
      }
    }

    // Validate the resulting (role, teamLead) combo via the C9/C16 validator.
    const compat = userService.validateTeamLeadCompatibility(subject.role, toTeamLeadDisplayName);
    if (!compat.valid) {
      throw new Error(`invalid resulting teamLead for ${subject.role}: ${compat.reason}`);
    }

    const fromTeamLead = subject.teamLead || null;
    if ((fromTeamLead || '').trim().toLowerCase() === toTeamLeadDisplayName.trim().toLowerCase()) {
      throw new Error('subject is already on that teamLead');
    }

    // Write — userModel.updateUser pushes the changeHistory entry.
    await userModel.updateUser(subjectEmail, {
      teamLead: toTeamLeadDisplayName,
      _changedBy: actor.email,
      _source: 'c19-transfer',
      _reason: reason || null,
    });

    logger.info('c19 transfer executed', {
      subject: subjectEmail,
      from: fromTeamLead,
      to: toTeamLeadDisplayName,
      actor: actor.email,
    });
    notifyTransfer({
      subjectEmail,
      fromName: fromTeamLead,
      toName: toTeamLeadDisplayName,
      actorEmail: actor.email,
    }).catch(() => {});

    return {
      subjectEmail,
      from: fromTeamLead,
      to: toTeamLeadDisplayName,
      transferredAt: new Date(),
      transferredBy: actor.email,
      reason,
    };
  }

  /**
   * Sweep cron entry point. Marks every row whose expiresAt has passed
   * and revokedAt is still null as expired. Returns the count.
   */
  async sweepExpired() {
    const now = new Date();
    // Read the soon-to-be-expired rows first so we can fire per-row
    // notifications. Tiny batch (typically <100 in a single tick).
    const expired = await this.collection().find({
      revokedAt: null,
      expiresAt: { $ne: null, $lte: now },
    }).toArray();
    if (expired.length === 0) return 0;

    const ids = expired.map((d) => d._id);
    const result = await this.collection().updateMany(
      { _id: { $in: ids } },
      { $set: { revokedAt: now, revokedBy: 'system:expiry' } },
    );

    logger.info('delegation sweep — expired', { count: result.modifiedCount });
    for (const doc of expired) {
      notifyDelegationRevoked(doc, true).catch(() => {});
    }
    return result.modifiedCount;
  }

  /**
   * Quarterly digest. Returns owner-keyed groups of active forever-shares
   * (expiresAt: null) for delivery via email or in-app summary. Cron
   * shells the actual delivery so this method stays pure (and testable).
   */
  async quarterlyDigest() {
    const cursor = this.collection().find({
      revokedAt: null,
      expiresAt: null,
    });
    const rows = await cursor.toArray();
    const byOwner = new Map();
    for (const r of rows) {
      const key = r.ownerEmail;
      if (!byOwner.has(key)) byOwner.set(key, []);
      byOwner.get(key).push(r);
    }
    return byOwner;
  }
}

export const delegationService = new DelegationService();
export { resolveTeamLeadEmail };
export const _testHelpers = { validateShareMatrix, computeExpiresAt, VALID_TTL_DAYS, describeScope };
