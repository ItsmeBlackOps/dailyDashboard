# Delegation & Co-Assignment — Implementation Plan

Spec: `docs/superpowers/specs/2026-06-12-delegation-coassign-redesign-design.md`
(approved in-chat 2026-06-12). Four PRs; each leaves main deployable.

## PR-1 — Backend core (this PR)

- `delegationService`: `status` machine (`pending → active | rejected`,
  legacy docs = active), approver resolution (owner's `teamLead` display name
  → email), new scopes `tasks` (≤10 ids, expiry = last task end +24h) and
  `day` (YYYY-MM-DD, expiry = end of day +28h), expert dashboard windows
  (`subtree` root=self + `startsAt`/`endsAt`, ≤30 days), lead-on-behalf
  grants (no approval), `approveRequest`/`rejectRequest`,
  `listPendingForApprover/Owner`, `eligibleOptions` (server-computed
  dropdowns), active-read filters gain `status` + `startsAt` gates.
- Routes/controller: experts may author (`EXPERT_AUTHORS`); new
  `GET /eligible`, `GET /pending-approvals`, `POST /:id/approve|reject`;
  `mine` returns `pendingOwned`.
- Co-assignees on tasks: `taskService.addCoAssignee` (admin/own-lead instant,
  cross-squad + expert-request pending with the expert's lead as approver,
  same-department guard), `approveCoAssignee`, `rejectCoAssignee`,
  `removeCoAssignee`; fields `coAssignees[]`, `pendingCoAssigns[]`,
  `coAssignHistory[]`; REST under `/tasks/:taskId/co-assignees`.
- Visibility: `Task.filterAndFormatTasks` honors `coAssignees` (self + lead
  team matching) and delegated coverage (`taskIdSet`/`dayGrants`/
  `windowOwners` built in `taskService.resolveDelegatedCoverage`).
- Tests: `delegationService.approvals.test.js` (10),
  `taskService.coAssign.test.js` (9).

## PR-2 — Delegations page rebuild

Dropdowns from `/eligible` (no free-text emails), plain-language form
(coverage type → people → window → reason), live summary sentence, TTL chips
(forever = admin-only), status chips + days-left pills + revoke cards,
"Awaiting your approval" inbox (share requests + cross-squad co-assigns),
"my requests" pending list. Expert view: simplified single form. Vitest in
the UserManagement style.

## PR-3 — Tasks Today + task pane

"Hand off" action on task cards (dialog: teammate dropdown, add-more-tasks
checklist, day/window shortcuts, summary line); "People on this task"
section in TaskSheet/TaskDetailPage (owner + co-experts + add/remove with
pending badges); "Covered by / Covering for" chips on task cards;
`getTaskById` returns `coAssignees`/`pendingCoAssigns`.

## PR-4 — Polish

Approve/reject deep links from bell notifications, popup for approver when
requests sit >24h, audit surfacing (coAssignHistory in the pane), docs
refresh (CLAUDE.md backlog + user-mgmt-audit note), prod verification with
the real Anusree/Subhash/Utsa flow.
