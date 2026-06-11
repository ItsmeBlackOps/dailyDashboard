# Interview Chains — design spec

> Status: draft for review · Author: assistant session 2026-06-10
> Validated against production data (19,982 taskBody docs) on 2026-06-10.

## 1. Problem & goal

Interviews for one opportunity (same candidate, same end client) arrive as
disconnected `taskBody` rows — Round 1, Round 2, Loop, Final each stand alone.
Transcripts, debriefs, and extracted questions are therefore *per round*: when
an expert preps Round 3, the system knows nothing about what was asked in
Rounds 1–2, even though those transcripts exist.

**Goal:** link the rounds of one opportunity into a *chain*, surface the chain
in the UI (round history + transcript availability), and feed prior-round
material into the AI generators (Interview Debrief, Extract Interviewer
Questions) and into the approved auto-generate-on-transcript queue.

## 2. What production data shows (measured 2026-06-10)

- Linking fields are ~100% populated: `Candidate Name` (19,981/19,982),
  `End Client` (19,979), `Interview Round` (19,977).
- Grouping by normalized candidate + normalized client yields **3,777 chains
  with ≥2 interviews**; 2,210 show ≥2 distinct rounds. Sizes: 2,330 pairs,
  766 triples, 340 of four, 305 of five+ (max 18).
- **Candidate alone is NOT a valid key:** of 1,282 candidates with ≥2 tasks,
  only 2% have a single end client. The key must be candidate **+ client**.
- Same client can host **two separate engagements** (rishitha mandali @ meta:
  July run 1st→4th, then a fresh Screening in September; eknath vamsi punna @
  capital one: Final on May 22 then a new Screening on June 11). A gap+reset
  rule must split these.
- `Interview Round` has 88 raw variants but the top labels ("1st round",
  "screening", "technical round", "2nd round", "final round", "loop round",
  numbered Nth) cover nearly everything.
- End-client spelling variants for the same candidate are rare (~6 candidates,
  e.g. "ally" vs "ally financial", "gm" vs "gm motors") — containment-level
  normalization suffices; no fuzzy matching needed in v1.
- **No transcript flag is stored in Mongo** (0 docs carry `transcription`).
  Availability lives in Appwrite keyed by task *subject*; the existing
  enrichment batches up to 50 subjects per call.

## 3. Chain model

A chain is computed, not stored (v1). Two tasks belong to the same chain when
ALL hold:

1. `normCandidate(a) === normCandidate(b)`
   - `norm`: trim, lowercase, collapse whitespace.
2. `normClient(a) === normClient(b)`
   - `norm` + strip punctuation + drop suffix words
     (inc, llc, corp, corporation, ltd, limited, technologies, technology,
     tech, solutions, group, co) + collapse whitespace.
   - Containment tolerance: if one normalized client strictly contains the
     other (`"ally"` ⊂ `"ally financial"`), treat as equal.
3. **Engagement split (gap + reset):** order the candidate+client group by
   `interviewStartAt`. Start a NEW chain at task *t* when
   `gap(t, prev) > CHAIN_SPLIT_DAYS (default 45)` **and**
   `roundRank(t) <= roundRank(prev)` (the round "reset"). A long gap alone
   (delayed final) or a reset alone (re-do, loop day disorder) does NOT split.
4. Tasks without `interviewStartAt` (~0.4%) attach to the chain only if a
   sibling exists within the same calendar month via `receivedDateTime`;
   otherwise they stand alone.

`roundRank` mapping (display keeps the raw label; rank is for ordering/reset
only): screening/hr/recruiter/intro → 0 · explicit digit or 1st/2nd/3rd → N ·
technical/coding → 5 · loop/onsite → 8 · final/last → 9 · unknown → null
(null never triggers a split).

Constants live in `backend/src/services/taskChainService.js` and are
env-overridable (`CHAIN_SPLIT_DAYS`).

## 4. API

`GET /api/tasks/:taskId/chain` (REST, auth required; same gate as
`GET /tasks/:taskId`).

Behavior:
1. Load the anchor task (`findOne _id`, heavy fields excluded) → 404/403 as in
   `getTaskById`.
2. Query siblings: `{ 'Candidate Name': <raw candidate> }` via the existing
   `Candidate Name` index (case-insensitive collation), then filter in memory
   by `normClient` + split rule. Candidate groups are ≤ dozens of docs —
   trivial.
3. **Visibility:** drop siblings failing `isTaskVisibleToUser(viewer)`. The
   response says how many rounds were hidden (`hiddenCount`) so the timeline
   can show "+2 rounds you don't have access to" without leaking content.
4. **Transcript availability:** one batched Appwrite lookup over the visible
   siblings' subjects (existing `enrichTranscriptsForTasks` path, ≤50 = 1
   call). Returned per sibling as `hasTranscript`.
5. Response:

```json
{
  "success": true,
  "chain": {
    "key": { "candidate": "anna joyce tenali", "client": "lantern" },
    "anchorTaskId": "<id>",
    "rounds": [
      { "taskId": "...", "roundLabel": "1st Round", "roundRank": 1,
        "interviewStartAt": "...", "jobTitle": "...", "status": "...",
        "hasTranscript": true, "isAnchor": false }
    ],
    "hiddenCount": 0
  }
}
```

No socket event in v1 (the dialogs fetch on open; chains change rarely).

## 5. UI

1. **Row chip** (TasksToday rows): when the loaded list itself contains ≥2
   tasks of the same chain key, show a subtle "Round N" chip computed
   client-side — zero extra requests. (The list already holds the rows; this
   is a `useMemo` grouping.)
2. **Round history panel** in the three AI dialogs (Debrief, Questions,
   Thanks): on open, call `/chain` once; render a compact timeline — date,
   round label, transcript dot, anchor highlighted — inside the dialog's
   scrollable body (per the #210 layout). Clicking a round with a transcript
   opens the existing transcript dialog for that task.
3. Empty/error states: chain of 1 → panel hidden; endpoint failure →
   panel hidden (never blocks the dialog's main function).

## 6. Chain-aware AI

Applies to **Interview Debrief** and **Extract Interviewer Questions**.
Thanks-mail stays per-round (it is a courtesy note about one interview).

Context assembly (server-side, in the two services):
1. Compute the chain for the task (same service as §4).
2. For each EARLIER round (rank/date before the anchor), prefer the **cached
   generated artifact** (stored debrief markdown / questions JSON) — small and
   already paid for. Only when an earlier round has a transcript but no cached
   artifact, include a trimmed transcript excerpt.
3. Hard caps: ≤ 3 prior rounds (most recent first), ≤ ~4,000 tokens of chain
   context total; excerpts truncated head+tail. Beyond the cap, older rounds
   are summarized by one line each (date + round label only).
4. Prompt addition (Debrief): "Earlier rounds in this interview process and
   what they covered: …". Prompt addition (Questions): "Questions already
   asked in earlier rounds (do not repeat, but list under a separate
   'previously asked' key): …" — the questions JSON schema gains an optional
   `previouslyAsked[]` array; UI renders it as a collapsed section.
5. **Caching semantics:** cached artifacts remain keyed per task. A cached
   result is served as-is even if a *new* earlier-round transcript appears
   later; the user's Regenerate button picks up the richer context. (Keeps
   v1 simple; no cache invalidation web.)
6. **Visibility for context:** user-initiated generations include only
   siblings visible to the requesting user. System-initiated (auto-trigger)
   generations include siblings visible to the task's *sender* (computed with
   the same scope builder) — the artifact lands on a task that sender's team
   owns.

## 7. Auto-trigger integration (approved earlier: future transcripts only)

`backend/src/jobs/transcriptAutoGenScheduler.js` (modeled on
candidateAlertScheduler):
1. Tick every 10 min: take tasks with `interviewStartAt` in the last 14 days,
   batch-check Appwrite transcript availability (existing 50-subject batches).
2. Watermark collection `transcriptAutoGenState` `{ taskId, seenAt, status }`.
   **First tick baselines**: every currently-transcribed task is recorded as
   `seen` WITHOUT generating (no backfill cost).
3. A task that newly flips to transcribed → enqueue `debrief`, `questions`,
   `thanksMail` jobs (status `queued`), processed **one at a time** with a
   short pause between AI calls; each generator already caches, so re-runs
   are no-ops. System runs bypass the per-user 3/6h rate limit via an internal
   flag (not exposed over HTTP).
4. Debrief + questions jobs use chain-aware context (§6). Failures mark
   `status: failed` with the error; retried once next tick; never blocks the
   tick.
5. Kill switch: `TRANSCRIPT_AUTOGEN_ENABLED` env (default ON after rollout
   phase C, OFF until then).

Cost note: ~3 Opus calls per newly transcribed task, serialized; chain context
adds prompt tokens bounded by §6's caps.

## 8. Rollout

- **Phase A** — `taskChainService` + `/chain` endpoint + dialog timeline + row
  chip. Read-only, reversible, validates linking quality on screen.
- **Phase B** — chain-aware context in debrief + questions (visible "uses N
  earlier rounds" note in the dialogs).
- **Phase C** — auto-trigger scheduler (flag-gated), using A+B.

Each phase is independently shippable and reviewable.

## 9. Testing

- `taskChainService` unit tests pinned to the real shapes found in prod:
  - meta re-engagement splits (gap > 45d + reset to Screening);
  - capital-one June 11 Screening starts a new chain after May 22 Final;
  - loop-day disorder (4× "Loop Round" same day, 6th before 5th) does NOT
    split and sorts by date;
  - client containment ("ally" ⊂ "ally financial") merges; distinct clients
    never merge.
- Endpoint tests: visibility filtering + `hiddenCount`; anchor 403/404 parity
  with `getTaskById`.
- AI context assembly: cached-artifact preferred over transcript; caps
  enforced; `previouslyAsked` present only when chain context exists.
- Scheduler tests: baseline-without-generating; new transcript enqueues 3;
  idempotent re-tick; rate-limit bypass flag never set from HTTP path.

## 10. Out of scope (v1)

- Materialized `chainId` on documents (revisit if the on-read computation
  ever shows up in perf metrics — candidate groups are tiny, it won't soon).
- Fuzzy client matching beyond containment.
- Cross-candidate analytics on chains (e.g., per-client question banks) —
  natural phase 2 once chains exist.
- Editing/overriding chains by hand.
