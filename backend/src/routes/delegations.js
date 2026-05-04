// C19 phase 3 — REST routes for delegations.
//
// All routes require authentication (mounted under the /api prefix).
// Role gating: only roles with management authority can grant/revoke.
// Recruiters and experts have no path here — they're never the actor.
// Subjects of a delegation are NOT gated by role; anyone can be shared.

import { Router } from 'express';
import { delegationController } from '../controllers/delegationController.js';
import { requireHTTPRole } from '../middleware/auth.js';

const router = Router();

// Roles allowed to perform any delegation operation. requireHTTPRole
// already accepts both legacy and new role names (PR #106), so listing
// either form works. Using both for clarity at the route level.
const DELEGATION_AUTHORS = [
  'admin',
  'mm', 'manager',
  'mam', 'am', 'assistantManager',
  'mlead', 'lead', 'teamLead',
];

// POST /api/delegations            grant a new share
router.post('/',
  requireHTTPRole(DELEGATION_AUTHORS),
  delegationController.grant);

// GET  /api/delegations/mine       grants where I am owner OR delegate
router.get('/mine',
  requireHTTPRole(DELEGATION_AUTHORS),
  delegationController.mine);

// GET  /api/delegations/owned?ownerEmail=  list outbound grants
//   defaults to my own; admin can pass ownerEmail to inspect others.
router.get('/owned',
  requireHTTPRole(DELEGATION_AUTHORS),
  delegationController.owned);

// POST /api/delegations/transfer   one-shot lateral move
//   Authority is checked in the service via the BFS — anyone with the
//   subject in their hierarchy can move them within compatibility rules.
router.post('/transfer',
  requireHTTPRole(DELEGATION_AUTHORS),
  delegationController.transfer);

// DELETE /api/delegations/:id      revoke (owner-or-admin gated in service)
router.delete('/:id',
  requireHTTPRole(DELEGATION_AUTHORS),
  delegationController.revoke);

export default router;
