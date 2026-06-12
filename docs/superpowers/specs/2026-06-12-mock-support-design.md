# Mock Support — dashboard-native mock interviews (design, approved 2026-06-12)

Approved by the owner; supersedes the never-implemented May-13 mock-tracker
docs (deleted). Source plan lived in the owner's local plan file; this spec is
the committed reference. Two amendments approved 2026-06-12 afternoon:
**co-experts on mocks** (reuse the task co-assign machinery end to end) and
**multiple linked interview tasks as references** on the create form.

## What it is

The whole mock-interview lifecycle on the dashboard: a Technical Team Lead
requests a mock for a candidate, the candidate's expert runs it at their own
pace (phone-first scheduling), everyone related to the candidate follows it
live, and the only email in the flow is the Teams calendar invite when the
expert creates the meeting. Fireflies records the mock; a **Mock Debrief** is
generated automatically from the transcript exactly like the interview
debrief.

## Status machine

```
requested → in_progress → scheduling → scheduled → meeting_created → connected → completed
                              ↓ (candidate unreachable)
                       recruiter_blocker → (resolved) → scheduling
cancelled ← lead/admin from any pre-completed state
```

- **requested** — lead/admin creates: candidate picker (lead's bench only:
  candidates whose `Expert` ∈ lead's reports, status Active/New), expert
  prefilled from `candidateDetails.Expert` (overridable), role/tech focus,
  **linkedTaskIds[] — multiple interview tasks of that candidate attached as
  references** ("based on these interviews' feedback we are taking this
  mock"), checklist (template + custom items), notes. No email.
- **in_progress** — assigned expert clicks Start when free (mocks are never
  fixed-time by design).
- **scheduling** — expert logs call attempts (reached / no answer /
  rescheduled + note). No answer → escalate to **recruiter_blocker**: the
  candidate's Recruiter gets a popup + red card; resolves with a note back to
  scheduling.
- **scheduled** — time agreed (`scheduledAt`); reschedules push prior slots to
  `scheduleHistory[]`.
- **meeting_created** — expert clicks "Create meeting & invite" just before
  the mock: materializes a `taskBody` row (`taskType:'mock'`,
  `mockRequestId`, subject `Mock Interview - <Candidate> - <Role> - <date/time
  EST>`) and calls meeting provisioning with a **mock payload variant that
  adds the candidate as a required attendee** (the flow's only email). Fred
  stays an attendee → recording; bot scheduler sees the row normally.
- **connected** — flips automatically via the Meeting Detector pipeline
  (meetingStarted on the materialized task mirrors to the mock) or manually.
- **completed** — expert submits the structured feedback form (seeded from
  the checklist; overall 1–5 + ready/needs_practice/not_ready verdict).
- **Mock Debrief** — transcript lands → `transcription:true` on the
  materialized row → `transcriptAutoGenScheduler` branches on
  `taskType:'mock'` → mock-specific debrief prompt → cached (Appwrite
  interview_debrief keyed by the materialized taskId) + posted into the mock
  thread + shown on the candidate profile.
- Every transition writes a `system` chat message — the thread is the audit
  log.

## Amendment 1 — co-experts on mocks (reuse co-assign)

- `mockRequests.coExpertEmails[]` — additional experts on the mock. Add via
  the same rules as task co-assign: lead adds own report instantly; cross-
  squad / expert-requested goes pending to the receiving expert's lead
  (reuse `resolveTeamLeadEmail` + the same notification pattern).
- At meeting materialization, `coExpertEmails` copies into the task row's
  `coAssignees[]` — so Tasks-page visibility, both extensions flipping
  meetingStarted, and the recorder-missing alert all work unchanged.
- Watchers include co-experts; the mock detail's People section mirrors the
  task pane's.

## Amendment 2 — linked interview references

- `linkedTaskIds: ObjectId-string[]` (≤10) + `linkedTaskSnapshots[]`
  (`{taskId, subject, interviewStartAt}` captured at create for display
  stability).
- Create form: after picking the candidate, a checklist of that candidate's
  recent interview tasks (by `Email ID`, latest ~15) to attach.
- Detail view: reference chips open the shared TaskSheet; the mock-debrief
  prompt receives the linked tasks' subjects (and their debriefs, when
  cached) as context.

## Data model

`mockRequests` (raw driver): `_id, candidateId, candidateName, role,
endClient?, linkedTaskIds[], linkedTaskSnapshots[], requestedBy{email,name},
expertEmail, coExpertEmails[], pendingCoExperts[{email,requestedBy,
requestedAt,approverEmail}], status, checklist[{id,label,required,done,
doneAt?}], callAttempts[{at,outcome,note?}], scheduledAt?, scheduleHistory[],
blocker?{raisedAt,raisedBy,note,resolvedAt?,resolvedBy?,resolution?},
meetingTaskId?, feedback?{overall,verdict,strengths,improvements,
detailedNotes,checklistCoverage[],submittedAt,submittedBy},
mockDebrief?{status,generatedAt?}, watchers[], statusHistory[], createdAt,
updatedAt`.

Indexes: `{status:1,createdAt:-1}`, `{expertEmail:1,status:1}`,
`{candidateId:1,createdAt:-1}`, `{meetingTaskId:1}`.

`mockMessages`: `{_id, mockId, author{email,name,role}, kind:'text'|'system',
body, createdAt}`, index `{mockId:1, createdAt:1}`.

Tasks-page exclusion: `taskType:{$ne:'mock'}` already applied to the
upcoming strip and gaps digest; add to `getTasksByRange`/`getTasksForUser`
initial matches when materialization ships (PR-3).

## Watchers (resolved at create, fail-soft)

Expert (+co-experts), candidate's Recruiter (raw email kept even if the
account is inactive — card shows a hint), recruiter's marketing lead + AM +
manager chain, requesting lead, admin implicitly. Watchers = visibility +
notification fan-out.

## API + sockets

```
POST   /api/mocks                      create (lead/admin)
GET    /api/mocks?status=&mine=        list (watchers ∪ admin)
GET    /api/mocks/:id                  detail
POST   /api/mocks/:id/start | call-attempt | blocker | reschedule
PATCH  /api/mocks/:id/blocker          resolve (recruiter)
POST   /api/mocks/:id/co-experts       add/request (+ approve/reject/remove)
POST   /api/mocks/:id/create-meeting   materialize + provision (mock payload)
POST   /api/mocks/:id/connected        manual fallback
PATCH  /api/mocks/:id/checklist
POST   /api/mocks/:id/feedback         completes
POST   /api/mocks/:id/cancel           lead/admin
GET    /api/mocks/:id/debrief          cached read
Sockets: joinMockRoom/getMockMessages/postMockMessage → 'mockMessage';
'mockUpdated' on transitions.
```

## UI

Sidebar "Mock Supports" (lead/expert/recruiter/mlead/mam/mm/admin; badge =
my open actions). Page: filter chips + cards (candidate, role, expert,
status pill, scheduled time, checklist ring, last activity; blocker = red).
Detail drawer: status stepper (blocker = red detour) · context header incl.
linked-interview reference chips · checklist tick-offs · ONE primary CTA per
state (Start → Log call → Create meeting & invite → Mark connected → Submit
feedback) · chat tab with system messages · feedback + debrief tab (rich
HTML + copy). Candidate profile: compact Mocks list. Completed +
needs_practice → "Request follow-up mock" (pre-seeded checklist,
previousMockId). Old email "Send Mock" dialog stays, gains a banner.

## Build order

PR-0 docs (this spec + stakeholder doc + stale-doc cleanup) · PR-1 core
(model + service + REST + page + sidebar + tests) · PR-2 chat + notifications
· PR-3 meeting + recording (materialization, mock event payload with
candidate attendee, tasks-page exclusion, auto-connected mirror) · PR-4
feedback + mock debrief · PR-5 polish (SLA nudges, follow-up mock, badges).
