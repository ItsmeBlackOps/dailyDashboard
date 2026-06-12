# Delegation & Co-Assignment Redesign — Design (approved 2026-06-12)

Approved in-chat by the owner across four design rounds. Supersedes nothing —
extends C19 (Share/Transfer) without changing its security model.

## One mental model, four tools

| Tool | Meaning | Lifetime | Approval |
|---|---|---|---|
| **Co-expert on a task** | Task genuinely has 2 experts (e.g. Utsa Maiti tagged on Subhash Sharma's task) | Until the task is done | Receiving expert's team lead (instant when the actor IS that lead, or admin) |
| **Single/few-task hand-off** | "Cover my 7 PM interview" — delegation scope `tasks` (≤10 ids) | Auto-expires 24h after the last task ends | Expert's own team lead (instant when lead-authored) |
| **Whole-day hand-off** | "Cover my Friday" — scope `day`; includes tasks that arrive that day | End of day +24h | Same |
| **Leave window** | "I'm out Jun 15–22" — scope `subtree` root=self with explicit `startsAt`/`endsAt` (≤30 days, may start in future) | The window | Same |

Leads/AMs/managers keep direct C19 shares (no approval). Everything is
non-destructive (ownership never moves), revocable, audited.

## Locked decisions

- **No email parsing.** Co-assignment happens only in the dashboard (task
  pane "People on this task"). The old "Tag: @Name" email habit is replaced
  by the UI.
- **Co-assign rules:** a lead picks from (a) **their own experts** → instant,
  (b) **all active experts of their department** (labeled with each expert's
  lead) → pending until the receiving expert's lead approves. Experts may
  request a co-expert → same approver. Cross-department co-assign is not
  offered.
- **Delegation status machine:** `pending → active | rejected` (new `status`
  field; legacy docs without it = active). Pending grants NOTHING.
  Approver = the requesting expert's team lead (resolved from the display-name
  `teamLead` field at request time; unresolvable → clean 400).
- Expert-authored windows use absolute dates, so approval timing never eats
  the window; tasks/day scopes expire from task/day times. The C19 TTL-chip
  set (7/15/30/180/forever) is untouched for lead+ shares; "forever" stays
  admin-only in the UI.
- **Both extensions can already start a co-covered meeting** — the
  meeting-presence endpoint matches by meeting link, not assignee. No change.
- **Visibility:** task scope = `assignedTo ∪ coAssignees ∪ active
  tasks/day-scope delegations`; lead scope = tasks where any of those people
  are their reports. Window (subtree) shares already union through the C19
  BFS for candidates; the same `listActiveForUser` filter change (status +
  startsAt) gates them automatically.
- **Dropdowns everywhere:** a server-computed `GET /api/delegations/eligible`
  returns delegates (share-matrix peers), my people, department experts
  (with their leads), and transfer targets — computed by the same rules that
  validate the writes, active users only.
- **UX:** plain language, prefills (self root, 7-day default), live summary
  sentence before every commit, one approvals inbox on the Delegations page
  (share requests + cross-squad co-assigns), status chips/days-left pills,
  hand-offs launched from Tasks Today task cards, task-pane People section.

## Build order

1. **PR-1 backend core** — status/approval machinery, new scopes, approver
   resolution, eligible endpoint, co-assign fields + endpoints, task
   visibility unions, notifications, tests.
2. **PR-2 Delegations page rebuild** — dropdowns/prefills/cards + approvals inbox.
3. **PR-3 Tasks Today + task pane** — "Hand off" dialog, People section, chips.
4. **PR-4 polish** — remaining notifications, audit surfacing, docs.

## Real-data reference flow (Venkata Kaseeswar Amirisetty, task 6a2c0c5a…)

Anusree Vasudevan opens the 2:00 PM task pane → "+ Add co-expert" → picks
Utsa Maiti (her own team) → instant. Both experts see the task (Tasks Today +
Starting-soon strip); whoever joins Teams first flips it (pane shows who).
Cross-squad variant: picking an expert under Prateek Narvariya creates a
pending co-assign that Prateek approves from his approvals inbox. Leave
variant: Subhash requests a Jun 15–22 window share to Utsa; Anusree approves;
the union activates Jun 15 00:00 and disappears Jun 23.
