// C19 phase 3 — thin controller wrapping delegationService.
//
// Auth + role gating happens at the route layer (requireHTTPRole).
// This controller only validates payload shape and surfaces clean
// errors. The service is the source of truth for share-matrix +
// authority rules.

import { delegationService } from '../services/delegationService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const errorResponse = (res, status, error) => {
  return res.status(status).json({ success: false, error });
};

const fromServiceError = (err) => {
  // delegationService throws Error with descriptive messages. Map to
  // a 400 (bad request) by default; specific 403/404 patterns override.
  const m = err.message || '';
  if (/not found/i.test(m)) return 400;
  if (/inactive/i.test(m)) return 400;
  if (/owner or an admin/i.test(m)) return 403;
  if (/share matrix violation/i.test(m)) return 403;
  if (/yourself/i.test(m)) return 400;
  return 400;
};

class DelegationController {
  /**
   * POST /api/delegations
   * Body: { ownerEmail, delegateEmail, scope, subjectEmails?,
   *         subtreeRootEmail?, ttlDays, reason? }
   *
   * Default ownerEmail = req.user.email (you grant from your own
   * subtree). Admin can pass an arbitrary ownerEmail.
   */
  grant = asyncHandler(async (req, res) => {
    const actor = req.user;
    const body = req.body || {};
    const ownerEmail = body.ownerEmail || actor.email;
    const payload = {
      ownerEmail,
      delegateEmail: body.delegateEmail,
      scope: body.scope,
      subjectEmails: body.subjectEmails,
      subtreeRootEmail: body.subtreeRootEmail,
      ttlDays: body.ttlDays === null ? null : Number(body.ttlDays),
      reason: body.reason,
    };

    try {
      const created = await delegationService.grant(actor, payload);
      return res.status(201).json({ success: true, delegation: created });
    } catch (err) {
      logger.warn('delegation grant failed', {
        actor: actor.email, error: err.message,
      });
      return errorResponse(res, fromServiceError(err), err.message);
    }
  });

  /**
   * GET /api/delegations/mine
   * Returns active grants where I am EITHER the owner or the delegate.
   * Used by the "My active shares" panel.
   */
  mine = asyncHandler(async (req, res) => {
    const me = (req.user.email || '').toLowerCase();
    const [ownedActive, delegatedToMe] = await Promise.all([
      delegationService.listActiveForOwner(me),
      delegationService.listActiveForUser(me),
    ]);
    return res.json({
      success: true,
      owned: ownedActive,        // grants I have made FROM my subtree
      delegated: delegatedToMe,  // grants made TO me
    });
  });

  /**
   * GET /api/delegations/owned?ownerEmail=...
   * Admin-only path for inspecting another user's outbound grants.
   * Without query: same as /mine#owned for the caller.
   */
  owned = asyncHandler(async (req, res) => {
    const actor = req.user;
    const requested = (req.query.ownerEmail || '').toString().toLowerCase().trim();
    const isAdmin = (actor.role || '').toLowerCase() === 'admin';
    const targetEmail = requested && isAdmin ? requested : (actor.email || '').toLowerCase();
    if (requested && !isAdmin && requested !== actor.email.toLowerCase()) {
      return errorResponse(res, 403, 'Only admin can list another user\'s delegations');
    }
    const owned = await delegationService.listActiveForOwner(targetEmail);
    return res.json({ success: true, ownerEmail: targetEmail, delegations: owned });
  });

  /**
   * POST /api/delegations/transfer
   * Body: { subjectEmail, toTeamLeadDisplayName, reason? }
   * One-shot lateral move. See delegationService.transfer for authority rules.
   */
  transfer = asyncHandler(async (req, res) => {
    const actor = req.user;
    const body = req.body || {};
    try {
      const result = await delegationService.transfer(actor, {
        subjectEmail: body.subjectEmail,
        toTeamLeadDisplayName: body.toTeamLeadDisplayName,
        reason: body.reason,
      });
      return res.status(200).json({ success: true, transfer: result });
    } catch (err) {
      logger.warn('delegation transfer failed', {
        actor: actor.email, error: err.message,
      });
      const status = /not in your authority/i.test(err.message) ? 403
        : /not found/i.test(err.message) ? 400
        : /already on that teamLead/i.test(err.message) ? 400
        : /invalid resulting/i.test(err.message) ? 400
        : 400;
      return errorResponse(res, status, err.message);
    }
  });

  /**
   * DELETE /api/delegations/:id
   * Body: { reason? }
   * Owner-or-admin gate enforced by the service.
   */
  revoke = asyncHandler(async (req, res) => {
    const actor = req.user;
    const { id } = req.params;
    const reason = (req.body && req.body.reason) || '';
    try {
      const updated = await delegationService.revoke(actor, id, reason);
      return res.json({ success: true, delegation: updated });
    } catch (err) {
      logger.warn('delegation revoke failed', {
        actor: actor.email, id, error: err.message,
      });
      return errorResponse(res, fromServiceError(err), err.message);
    }
  });
}

export const delegationController = new DelegationController();
