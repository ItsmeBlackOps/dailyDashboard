# Premature Meeting-Start Remediation — Implementation Plan

> **For agentic workers:** execute task-by-task (subagent-driven or inline). Steps use `- [ ]`.

**Goal:** Stop meetings being marked "Started" >60 min early (guard), clear the 5 bad marks, warn the 2 offenders 3× and their team lead once.

**Architecture:** Backend guard in `markMeetingStarted` + a one-shot "meeting-start warning" mirroring the one-time-ack pattern (config + user subdoc + GET/PATCH + cache + modal). A committed mongosh remediation script does the data cleanup + seeds the warnings + team-lead notifications, run post-deploy.

**Tech Stack:** Node ESM/Express 5/raw Mongo driver/Jest; React 18/TS/Vitest; mongosh for the one-shot.

---

### Task 1: Prevention guard in `markMeetingStarted`

**Files:** Modify `backend/src/controllers/taskController.js` (~353); Test `backend/test/taskController.meetingStartGuard.test.js`.

- [ ] **Step 1** — Add the guard between the idempotency return (line 353) and the write (line 355):

```js
    // Time-window guard (C-remediation): a meeting may only be marked started
    // within 60 minutes of its scheduled start. Marking earlier misfeeds the
    // "started" status and is treated as an SOP breach.
    const MARK_WINDOW_MS = 60 * 60 * 1000;
    if (task.interviewStartAt) {
      const msUntilStart = new Date(task.interviewStartAt).getTime() - Date.now();
      if (Number.isFinite(msUntilStart) && msUntilStart > MARK_WINDOW_MS) {
        const minutes = Math.ceil(msUntilStart / 60000);
        return res.status(400).json({
          success: false,
          code: 'TOO_EARLY',
          error: `This meeting is scheduled in ~${minutes} min. You can mark it started only within 60 minutes of the start time.`,
        });
      }
    }
```

- [ ] **Step 2** — Test: too-early (now+2h) → 400 `TOO_EARLY` + no write; within window (now+30m) → 200 + write; missing `interviewStartAt` → 200; already-started + far-future → 200 idempotent (guard skipped). Mock `database.getCollection`.
- [ ] **Step 3** — Commit.

---

### Task 2: Warning config + User cache

**Files:** Create `backend/src/config/meetingStartWarning.js`; Modify `backend/src/models/User.js:54`; Test `backend/test/user.formatCachePayload.meetingStartWarning.test.js`.

- [ ] **Step 1** — Config:

```js
// One-shot remediation: experts who marked meetings "started" >60 min early
// (an SOP breach) see this on their next `maxShows` loads, then it disappears.
// Armed per-offender by the remediation script — the presence of a
// `meetingStartWarning` subdoc on the user IS the trigger (no version needed).
export const MEETING_START_WARNING = {
  title: 'Meeting marked started too early',
  maxShows: 3,
  body: [
    'You marked one or more meetings as "Started" well before their scheduled time.',
    'Marking a meeting started before it begins misfeeds the information and is treated as a breach of SOP.',
    'Only toggle "Meeting Started" within 60 minutes of the scheduled start, once the meeting is actually beginning.',
    'We have cleared these incorrect marks from the record.',
  ],
};
```

- [ ] **Step 2** — `formatCachePayload` (User.js:55, after `marketingMeetingAck`): add
  `meetingStartWarning: userDoc.meetingStartWarning || null,`
- [ ] **Step 3** — Test (mirror `user.formatCachePayload.ack.test.js`): carries `meetingStartWarning` when present; `null` when absent.
- [ ] **Step 4** — Commit.

---

### Task 3: GET/PATCH warning endpoints + routes

**Files:** Modify `backend/src/controllers/userController.js` (after `updateMyMarketingMeetingAck`, import the config); `backend/src/routes/users.js` (after line 21); Test `backend/test/userController.meetingStartWarning.test.js`.

- [ ] **Step 1** — Import: `import { MEETING_START_WARNING } from '../config/meetingStartWarning.js';`
- [ ] **Step 2** — Handlers:

```js
  // One-shot premature-meeting-start warning. The presence of the seeded
  // `meetingStartWarning` subdoc arms it; it shows for `maxShows` dismissals.
  getMyMeetingStartWarning = asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user?.email) return res.status(401).json({ success: false, error: 'Authentication required' });
    try {
      const record = userModel.getUserByEmail(user.email) || {};
      const w = record.meetingStartWarning || null;
      const shownCount = Number(w?.shownCount) || 0;
      const required = Boolean(w && !w.dismissed && shownCount < MEETING_START_WARNING.maxShows);
      return res.json({
        success: true,
        required,
        shownCount,
        maxShows: MEETING_START_WARNING.maxShows,
        content: required
          ? { title: MEETING_START_WARNING.title, body: MEETING_START_WARNING.body, meetings: Array.isArray(w.meetings) ? w.meetings : [] }
          : null,
      });
    } catch (error) {
      logger.error('getMyMeetingStartWarning failed', { error: error.message, email: user.email });
      return res.status(500).json({ success: false, error: 'Unable to read warning status' });
    }
  });

  acknowledgeMyMeetingStartWarning = asyncHandler(async (req, res) => {
    const user = req.user;
    if (!user?.email) return res.status(401).json({ success: false, error: 'Authentication required' });
    try {
      const record = userModel.getUserByEmail(user.email) || {};
      const w = record.meetingStartWarning || {};
      const next = Math.min((Number(w.shownCount) || 0) + 1, MEETING_START_WARNING.maxShows);
      const dismissed = next >= MEETING_START_WARNING.maxShows;
      await userModel.updateUser(user.email, {
        'meetingStartWarning.shownCount': next,
        'meetingStartWarning.dismissed': dismissed,
        'meetingStartWarning.lastShownAt': new Date().toISOString(),
        _changedBy: user.email,
        _source: 'self-meeting-start-warning',
      });
      return res.json({ success: true, shownCount: next, required: !dismissed });
    } catch (error) {
      logger.error('acknowledgeMyMeetingStartWarning failed', { error: error.message, email: user.email });
      return res.status(500).json({ success: false, error: 'Unable to record acknowledgment' });
    }
  });
```

- [ ] **Step 3** — Routes (after line 21):

```js
router.get('/me/meeting-start-warning', userController.getMyMeetingStartWarning);
router.patch('/me/meeting-start-warning', userController.acknowledgeMyMeetingStartWarning);
```

- [ ] **Step 4** — Test: not-armed (no subdoc) → required:false; armed shownCount 0/1/2 → required:true; PATCH 0→1→2→3 (3rd sets dismissed) then GET → required:false. Mock `userModel`.
- [ ] **Step 5** — Commit.

---

### Task 4: Frontend `MeetingStartWarningModal` + mount

**Files:** Create `frontend/src/components/MeetingStartWarningModal.tsx`; Modify `frontend/src/components/layout/DashboardLayout.tsx` (import + mount beside `<TechnicalAckModal />` at line 86); Test `frontend/src/components/__tests__/MeetingStartWarningModal.test.tsx`.

- [ ] **Step 1** — Component (mirror `TechnicalAckModal.tsx`; single "I understand" button, no checkbox; lists meetings):

```tsx
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { parseJsonOrThrow } from '@/lib/fetchJson';

interface WarnMeeting { candidate?: string; scheduledEst?: string }
interface WarnContent { title: string; body: string[]; meetings: WarnMeeting[] }
interface WarnStatus { required: boolean; shownCount: number; maxShows: number; content: WarnContent | null }

export function MeetingStartWarningModal() {
  const { authFetch } = useAuth();
  const [content, setContent] = useState<WarnContent | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${API_URL}/api/users/me/meeting-start-warning`);
        const data = await parseJsonOrThrow<WarnStatus>(res);
        if (!cancelled && data.required && data.content) { setContent(data.content); setOpen(true); }
      } catch { /* non-blocking */ }
    })();
    return () => { cancelled = true; };
  }, [authFetch]);

  const acknowledge = async () => {
    setSubmitting(true);
    try {
      const res = await authFetch(`${API_URL}/api/users/me/meeting-start-warning`, { method: 'PATCH' });
      await parseJsonOrThrow(res);
      setOpen(false);
    } catch { /* close anyway; re-shows next load if still required */ setOpen(false); }
    finally { setSubmitting(false); }
  };

  if (!content) return null;
  return (
    <Dialog open={open} onOpenChange={() => { /* acknowledge-only */ }}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>{content.title}</DialogTitle></DialogHeader>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          {content.body.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
        {content.meetings.length > 0 && (
          <div className="mt-2 rounded-md border bg-muted/40 p-3 text-xs">
            <p className="mb-1 font-medium">Meetings affected</p>
            <ul className="space-y-1">
              {content.meetings.map((m, i) => (
                <li key={i}>{m.candidate || 'Candidate'}{m.scheduledEst ? ` — scheduled ${m.scheduledEst}` : ''}</li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => void acknowledge()} disabled={submitting}>
            {submitting ? 'Saving…' : 'I understand'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2** — Mount: import in `DashboardLayout.tsx` and render `<MeetingStartWarningModal />` next to `<TechnicalAckModal />`.
- [ ] **Step 3** — Test: mock `authFetch`; required+content → dialog with title + meetings; click "I understand" → PATCH called + closes; not-required → renders nothing.
- [ ] **Step 4** — Commit.

---

### Task 5: Remediation mongosh script (committed; run post-deploy)

**Files:** Create `backend/scripts/remediate-premature-meeting-starts.mongo.js`.

- [ ] **Step 1** — Script: a 60-min query over `taskBody`; per premature task `$unset` the 3 mark fields + insert a `meetingStartRemediations` audit row; group by `meetingStartedBy`; per offender seed `users.meetingStartWarning` (`shownCount:0, dismissed:false, meetings:[{candidate, scheduledEst}], clearedAt, by:'Harsh Patel'`) and upsert one `notifications` doc to the resolved team-lead email (deterministic `eventId`, 90-day `expiresAt`, `title`+`description` from the spec). Print a summary. Idempotent (dedup on eventId; re-running the un-mark is a no-op once cleared). Eastern formatting via fixed `America/New_York` offset note in-script.
- [ ] **Step 2** — Commit (do NOT run yet — runs after the guard deploys).

---

### Task 6: Verify + PR

- [ ] **Step 1** — `cd backend && npm test` for the 3 new specs (DB-less). Note: Atlas-dependent suites fail offline (querySrv) — expected; diff against main.
- [ ] **Step 2** — `cd frontend && npx vitest run src/components/__tests__/MeetingStartWarningModal.test.tsx` + `npm run build`.
- [ ] **Step 3** — Push branch, open PR `feat(tasks): guard premature meeting-start + remediate the 5 early marks (warn experts 3x + team lead once)`. Plain message, no AI trailer.
- [ ] **Step 4** — After deploy: run the remediation script; verify via mongosh (5 tasks cleared, 2 warnings armed, Prateek has 2 notifications).
