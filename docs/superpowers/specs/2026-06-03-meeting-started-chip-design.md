# Meeting-started chip + one-time legend — design

> Date: 2026-06-03
> Status: approved (brainstorming) — pending implementation plan
> Area: Tasks Today row — replace the SP2 "Mark started"/"Started ✓" stacked buttons with a color-only chip + a one-time legend pop-up.

## 1. Problem

SP2 added a per-row Meeting-Started control as a **stacked second row** of buttons (`Mark started` / `Started ✓`) in the meetings cell, and it renders on **every** row including **Cancelled/Completed**. Result: the row is cluttered, taller, and shows a nonsensical "Mark started" on cancelled meetings. We want a compact, color-only indicator everyone can read at a glance, plus a one-time pop-up that teaches the legend.

## 2. Decisions (locked with user)

- **Color-only chip, no text.** 🟢 green = meeting started; ⚪ grey = not started yet.
- **One click** to start (for those allowed); flips to green for **all** viewers.
- **One-time legend pop-up** shown once per user explaining the two colors; dismiss with "Got it"; never shown again.
- **Must not break the row layout** — single inline element, no second row.
- Frontend-only (the SP2 `PATCH /api/tasks/:taskId/meeting-started` endpoint + the `canMarkStarted`/`handleMarkStarted` helpers already exist and are reused unchanged).

## 3. Design

### 3a. The chip (TasksToday meetings cell)

Replace the SP2 stacked block (the `<div className="mt-1">…Started ✓ / Mark started / Not started…</div>`) with a single inline indicator placed next to `[Join] [copy]`:

- **`task.meetingStarted === true`** → a green **filled** circle icon (lucide `CheckCircle2`, green), read-only, `title`/`aria-label` = `Meeting started${by/at}`. Shown to everyone.
- **not started + `canMarkStarted`** (assigned expert / `am` / `lead` / `admin`) → a grey **hollow** circle icon (lucide `Circle`) rendered as a `<button>`; `aria-label`/`title` = "Mark meeting started"; one click → existing `handleMarkStarted(task)` → flips to green for all viewers.
- **not started + not allowed** → the same grey hollow circle as a non-interactive `<span>` (indicator only; `aria-label` = "Meeting not started yet").
- **Hidden entirely** when `task.status` is `Cancelled` or `Completed` (compare via the same status the row colouring uses; case-insensitive). Still inside the existing `{meetingsEnabled && …}` cell.

No text label — the color + icon shape carry the meaning; `title`/`aria-label` provide the accessible name (a11y requirement since there's no visible text).

### 3b. One-time legend pop-up

New component `MeetingStartedLegendModal.tsx`, mounted in `TasksToday` (the only place the chip appears, so the legend shows in context):
- On mount, read a localStorage key `prt.seenMeetingStartedLegend`. If unset, open a small shadcn `Dialog`.
- Content: a short legend — a green `CheckCircle2` "= meeting started" and a grey `Circle` "= not started yet", plus one line: "If you run the meeting, click the grey dot to mark it started."
- Single **"Got it"** button → `localStorage.setItem('prt.seenMeetingStartedLegend','1')` → close. No other dismissal needed (informational).
- Shown to **all** users who open Tasks Today, **once per browser** (localStorage). (Per-browser, not per-account — accepted for simplicity; a server-backed per-account flag is out of scope.)

## 4. Testing

- **Vitest** (`MeetingStartedChip`/cell + legend):
  - chip: started → green read-only; not-started + canToggle → clickable grey that calls the mark-started handler; not-started + !canToggle → grey non-interactive; hidden when status Cancelled/Completed.
  - legend: renders when localStorage key unset; after "Got it" the key is set and it closes; does not render when the key is already set.
- `tsc --noEmit` clean; manual smoke that the row is a single line (no second row) and cancelled/completed rows show no chip.

## 5. Revision — marketing acknowledgment replaces the localStorage legend

The simple localStorage "Got it" legend (§3b) is **replaced** by a server-recorded **marketing-team acknowledgment**, mirroring the SP2 technical-team ack. (Two one-time acks now exist: technical = "you must toggle Meeting Started"; marketing = "here's what the chip means.")

- **Audience:** marketing roles only — legacy tokens `admin`, `mm`, `mam`, `mlead`, `recruiter` (the PRT_READ_ROLES set). Technical roles never see it.
- **Behavior:** one-time per user, versioned, server-recorded (auditable). An **"I acknowledge"** checkbox enables **Submit**; shown once until the version is bumped. Mirrors SP2's `technicalAck` pattern exactly (a `marketingMeetingAck { version, agreedAt }` subdoc + `GET`/`PATCH /api/users/me/marketing-meeting-acknowledgment`, parallel to the technical endpoints; reuse the `userController`/`routes/users.js`/`User` patterns).
- **Content:** shows the **actual chip elements** —
  - 🟢 green `CheckCircle2` = **Meeting started** — the **Expert joined the meeting** (hover the green mark in a row to see the exact join time, in Eastern).
  - ⚪ grey `Circle` = **not started yet**.
  - one line: "Hover the green mark to see when the expert joined (EST)."
- **Replaces:** `MeetingStartedLegendModal` (localStorage) is removed; the new `MarketingMeetingAckModal` (server-driven, marketing-gated) is mounted in its place in TasksToday. Because it's gated to marketing roles, the existing TasksToday page tests (user role `user`/`expert`) won't trigger it — the localStorage suppression added for the legend can be dropped (the GET simply returns `required:false` for non-marketing).

### Chip tooltip — EST join time (§3a refinement)
The green (started) chip's hover tooltip reads **"Expert joined at h:mm AM/PM EST"**, formatting `meetingStartedAt` in Eastern time. Reuse TasksToday's existing Eastern-time formatter (the same one used for the meeting subject, e.g. `easternDateTime` + "EST"). The grey chip tooltip stays "Meeting not started yet".

## 6. Out of scope
- A generic multi-ack framework (we add the marketing ack parallel to the technical one; generalize only if a 3rd ack appears).
- Any change to the SP2 Meeting-Started toggle endpoint / gate (reused as-is).
- SP3 (ISO-date filtering + sorting) — separate spec.
