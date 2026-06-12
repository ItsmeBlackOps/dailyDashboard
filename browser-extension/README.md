# Interview Meeting Detector (browser extension)

Detects when an expert **actually joins** a Teams interview in the browser (the
live call — not the pre-join screen and not the lobby) and tells the Daily
Dashboard, which flips the task's `meetingStarted` flag live for everyone.

## How it works

```
Teams meeting tab            Extension                 Dashboard
─────────────────            ─────────                 ─────────
content.js watches the DOM
  pre-join / lobby → ignored
  IN-CALL detected ─────────▶ background.js
                              POST /api/meeting-presence/report
                              (Bearer <detector token>)  ───────▶ match task by
                                                                   meeting_<id> in the
                                                                   join URL → set
                                                                   meetingStarted → the
                                                                   taskBody change stream
                                                                   broadcasts to all
                                                                   dashboards (live badge)
```

- **Lobby vs in-call:** `content.js` only fires `in_call` when a leave/hang-up
  control AND a second live-call marker (call timer or roster) are present and
  no lobby text is showing, held stable for ~4s. Lobby and pre-join are
  reported but the backend never flips the flag for them.
- **Correlation:** the backend matches on the stable `meeting_<id>` token in the
  Teams join URL — never the title (titles drift when meetings are rescheduled).
- **Auth:** every report carries a per-expert, long-lived, narrowly-scoped
  token that is ONLY valid on `/api/meeting-presence/report` (the normal API
  rejects it). MV3 `host_permissions` exempt the requests from CORS.

## Install (unpacked, for testing / internal distribution)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked** → select this `browser-extension/` folder.

## Enroll (automatic)

Once installed, the extension **signs itself in** using your dashboard login —
`dashboard-bridge.js` reads the access token the dashboard already stores in
`localStorage` (plus the API base it writes for us) and the background worker
exchanges it for a long-lived, meeting-presence-scoped detector token. Just open
the dashboard once after installing; nothing to copy or paste.

There is no manual setup — the options page is a status view only (Connected
as <email> / "open the dashboard to connect"). If it ever fails to connect,
opening the dashboard again retries automatically every few seconds.

Then join Teams meetings in this browser as usual. The icon shows a green dot
while you're reported as in-call.

## Presence handshake (gate)

`dashboard-bridge.js` runs on the dashboard origin and answers a
`window.postMessage` ping from the page, so the dashboard can detect that the
extension is installed (no extension ID needed). The dashboard uses this to
**require** the extension for technical-team members: they see a self-clearing
install guide until the extension is detected, then they're let in
automatically. `host_permissions` includes the dashboard + API domains so the
report POST and the handshake are exempt from CORS.

## Limitations

- **Browser joins only** — if an expert joins from the Teams *desktop app*, the
  extension can't see it. (Not a concern here — experts join in the browser.)
- Teams occasionally changes its DOM; the `data-tid` / `aria-label` selectors in
  `content.js` may need the odd update.
- Some orgs block custom extensions; distribute privately via Intune / group
  policy if needed.

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest (host permissions, content script, worker) |
| `content.js` | Teams DOM state machine (pre-join / lobby / **in-call**) |
| `background.js` | service worker — POSTs reports with the detector token |
| `options.html` / `options.js` | enrollment (dashboard URL + token) |
| `popup.html` / `popup.js` | status (connected? last report) |
