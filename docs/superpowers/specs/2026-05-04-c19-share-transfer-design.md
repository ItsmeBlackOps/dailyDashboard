# C19 — Share + Transfer design spec

Brainstormed 2026-05-04. Locks the design decisions for the time-bound delegation (Share) and lateral peer Transfer feature flagged in `user-mgmt-audit.html`.

## Goal

Replace the current "silently overwrite teamLead" pattern with two explicit, audited operations:

1. **Share** — owner grants a peer read+write on N specific subordinates (or their full subtree) for a TTL: `7d / 15d / 1mo / 6mo / forever`.
2. **Transfer** — one-shot lateral move of a subordinate's `teamLead` to a peer.

The C19 hard rule: **peer cannot manage peer except through these ops.** No more silent reassignment in bulk-edit (PR #98 closed the silent path; C19 adds the legitimate path back).

## Locked decisions

### Subject scope (Q1)

Two scopes, selectable per share:
- **`specific`** — explicit list of subordinate emails. New hires during the share window are NOT covered.
- **`subtree`** — share rooted at one user; covers their current and any future direct reports for the duration.

UX defaults to `subtree` (matches the OOO use case). Drops to `specific` for curated handoffs (akash.avasthi formalization).

### Cross-team manager shares (Q2)

Only `manager` role can grant cross-team shares (formalizes Tushar's de-facto access).

`expiresAt: null` means forever. Forever shares are **trusted until explicitly revoked** — no mandatory periodic re-confirmation. To prevent dead-grant accumulation, owner gets a **quarterly digest** listing all active forever-shares granted from their subtree, with one-click revoke per row.

### Transfer authority (Q3)

Every level can execute Transfer, scoped to their own authority:
- **teamLead** → transfer one of their direct reports to a peer teamLead within the same assistantManager subtree.
- **assistantManager** → transfer anyone in their subtree, including across teamLeads.
- **manager** → transfer anyone in their team, including across assistantManagers.
- **admin** → transfer anyone (cross-team included).

One-shot. No two-step approval. Source loses access immediately, destination gains immediately. Audited.

### Offboarding (Q4)

When a user is deactivated:
- **Delegate offboarded** → all shares to them are hard-revoked. Owner notified so they can re-share.
- **Owner offboarded** → all shares from their subtree are hard-revoked. Owner's manager notified to manually re-grant or transfer.

Never auto-transfer subtrees on offboarding — auto-moves can mask real access issues. Force a human decision.

### Notifications (Q5)

Full transparency. In-app notifications via the existing `notifications` collection:
- **Share granted** → owner (confirmation), delegate (new access), each subject (someone new can manage you).
- **Share auto-expired / revoked** → owner, delegate, each subject.
- **Transfer** → source teamLead, destination teamLead, subject (your reporting line changed), and the source's manager when the move crosses an assistantManager boundary.
- **Quarterly digest** → owner only (forever-share inventory).

## Schema — `userDelegations` collection

```js
{
  _id: ObjectId,
  ownerEmail: 'bhavya.dutt@vizvainc.com',
  delegateEmail: 'umang.pandya@silverspaceinc.com',
  scope: 'subtree' | 'specific',
  // For 'specific': explicit list of subordinate emails.
  // For 'subtree':  empty array; subjects derived from the owner's
  //                 BFS at read time (so new hires under owner are
  //                 automatically covered).
  subjectEmails: ['expert.a@...', 'expert.b@...'],
  // Used only when scope='subtree' — root of the subtree (usually the
  // owner themselves; an owner can also share a sub-subtree, e.g. a
  // mam delegating one of their teamLead subtrees).
  subtreeRootEmail: 'bhavya.dutt@vizvainc.com' | null,
  grantedAt: ISODate,
  grantedBy: 'bhavya.dutt@vizvainc.com',
  // null means forever. Otherwise a Date.
  expiresAt: ISODate | null,
  revokedAt: ISODate | null,
  revokedBy: string | null,
  reason: string,                          // free text, e.g. "PTO 7d"
  source: 'manual-ui' | 'system:c19-migration' | 'system:offboarding',
}
```

**Indexes:**
- `{ delegateEmail: 1, expiresAt: 1, revokedAt: 1 }` — hot read path (BFS union).
- `{ ownerEmail: 1, revokedAt: 1 }` — owner's "my active shares" panel and quarterly digest.
- `{ expiresAt: 1, revokedAt: 1 }` — sweep cron's TTL scan.

## Backend — services / routes / cron

### `backend/src/services/delegationService.js` (new)

Methods:
- `grant(actor, payload)` — validate against share matrix + scope rules + actor's authority. Insert row. Emit notifications to owner, delegate, subjects.
- `revoke(actor, delegationId, reason)` — set `revokedAt` / `revokedBy`. Emit notifications.
- `transfer(actor, payload)` — validate authority. Update target user's `teamLead` field. Push changeHistory entry on the user (re-uses existing audit pipeline). Emit notifications.
- `listActiveForUser(email)` — used by BFS union. Returns active grants where `delegateEmail = email`, indexed read.
- `listActiveForOwner(ownerEmail)` — "my active shares" panel.
- `sweepExpired()` — hourly cron. Sets `revokedAt = now`, `revokedBy: 'system:expiry'` for any row past `expiresAt`. Emit notifications.
- `sweepOffboarding(deactivatedEmail)` — hard-revoke shares where the deactivated user is owner OR delegate. Emit notifications.

### `backend/src/routes/delegations.js` (new)

```
POST   /api/delegations               grant + scope + duration
GET    /api/delegations/mine          delegations where I am owner OR delegate
GET    /api/delegations/owned         owner's "my active shares" view
DELETE /api/delegations/:id           revoke (owner or admin)
POST   /api/delegations/transfer      lateral move (separate endpoint — different shape)
```

Each guarded by `requireHTTPRole(['admin','manager','assistantManager','teamLead','mm','mam','am','mlead','lead'])` — recruiters/experts cannot grant or transfer.

### BFS union

`userService.isUserInRequesterHierarchy` and `candidateService.collectHierarchyEmails` consult delegations:

```js
// Pseudo
const directReports = bfsByTeamLead(requester);
const delegated = await delegationService.listActiveForUser(requester.email);
for (const d of delegated) {
  if (d.scope === 'specific') addAll(directReports, d.subjectEmails);
  else if (d.scope === 'subtree') addAll(directReports, bfsByTeamLead(d.subtreeRootEmail));
}
return directReports;
```

### Sweep cron

`backend/src/jobs/delegationSweepScheduler.js` — hourly tick. Calls `delegationService.sweepExpired()`.

## Frontend

### User Management page

Per-user row actions:
- "Share with peer" — opens a dialog with: scope (specific/subtree), TTL, peer selector (filtered to the share matrix), reason.
- "Transfer to peer" — opens a confirm dialog: "Move X from teamLead Y to teamLead Z. Y will lose access immediately."

New side-panel: **"My active shares"** — table of grants where I am owner OR delegate, with revoke action per row.

### Notifications

Reuses existing `notifications` collection. Uses the standard delivery (in-app bell + websocket push). One notification type per event listed in Q5.

## Tushar formalization migration

One-shot mongosh script: `backend/scripts/c19-formalize-existing.mjs`. DRY_RUN by default.

Creates forever-shares for known de-facto access patterns:
- Other managers → Tushar Ahuja, scope `subtree`, root = peer manager's email.
- (akash/adnan are already correct teamLeads per the audit's correction; no migration needed for them.)

Reason: `'c19-migration: formalize de-facto access at C19 launch'`.

## Phasing (one PR per phase)

1. **Phase 1 — schema + service skeleton.** New collection, indexes, `delegationService.js` with `grant/revoke/listActiveFor*` (no notifications yet, no transfer). Unit tests with mocked userModel.
2. **Phase 2 — BFS union.** `userService` and `candidateService` hierarchy walks read delegations. Integration test: Bhavya shares with Umang → Umang's BFS now includes Bhavya's experts.
3. **Phase 3 — REST routes + UI.** Routes guarded by share-matrix validator. UI for grant/revoke + "My active shares" panel.
4. **Phase 4 — Transfer.** Service method + route + UI confirm dialog. Subject teamLead update via existing audit-aware updateUser.
5. **Phase 5 — Notifications + sweep cron.** All event types plumbed. Hourly sweep. Quarterly digest.
6. **Phase 6 — Tushar formalization migration.** Script + one-time run.

## Phase 1 starts in this PR.
