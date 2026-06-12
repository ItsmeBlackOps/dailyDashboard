# Distributing the Interview Meeting Detector (zip / load-unpacked)

This is the manual rollout: package the extension as a zip, share it (Teams /
SharePoint / email), and have each expert load it once. Works in both **Chrome**
and **Edge**.

> Trade-offs of this method: it needs Developer mode, and it does **not**
> auto-update — when a new version ships you re-share the zip and people reload
> it. For a hands-off, auto-updating rollout later, switch to a store listing +
> Intune/Google-Admin force-install (see the team that owns browser policy).

---

## 0. Easiest path — the in-app download

Experts don't actually need a file from you: the dashboard has a **Download
extension** button (on the *Meeting Detector* page and on the "not installed"
reminder) that serves the latest zip from a stable bucket URL. Point people
there and skip to step 2.

## 1. Package + publish (you, once per release)

From the repo root:

```bash
bash browser-extension/package.sh            # -> browser-extension/dist/...-v<version>.zip
node backend/scripts/uploadExtensionZip.mjs  # uploads it to the bucket (versioned + -latest)
```

`package.sh` reads the version from `manifest.json`. `uploadExtensionZip.mjs`
pushes the zip to Supabase storage and overwrites the stable
`extensions/interview-meeting-detector-latest.zip` that the in-app Download
button links to — so bumping the manifest version + re-running these two
commands is the whole release. (You can also just hand out the dist zip
directly.)

> No `package.sh`? On Windows you can also run, from the repo root:
> `powershell -Command "Compress-Archive -Path browser-extension/*.json,browser-extension/*.js,browser-extension/*.html,browser-extension/*.md -DestinationPath interview-meeting-detector.zip -Force"`

---

## 2. Install (each expert, once)

**Important:** unzip to a **permanent folder** first (e.g.
`Documents\InterviewMeetingDetector`). If that folder is deleted or moved, the
extension stops working.

### Chrome
1. Unzip the file to a permanent folder.
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the unzipped folder (the one containing
   `manifest.json`).

### Edge
1. Unzip the file to a permanent folder.
2. Go to `edge://extensions`.
3. Turn on **Developer mode** (left side).
4. Click **Load unpacked** and select the unzipped folder.

When loaded, the extension icon appears in the toolbar. The dashboard's amber
"Meeting Detector not installed" notice disappears within a second or two.

---

## 3. Connect it — automatic

Nothing to do. After installing, open the dashboard once; the extension reads
your dashboard login from the page and **signs itself in** (no token to copy).
The amber "not installed" reminder disappears within a second or two.

If it doesn't connect on its own (rare — e.g. you weren't logged in yet), open
**Meeting Detector** in the sidebar → expand **Manual setup**, generate a token,
and paste it + the Dashboard URL into the extension's setup page.

Then joining a Teams meeting in the browser marks the interview as started
automatically.

---

## 4. Updating to a new version

1. You re-run `package.sh` and re-share the new zip.
2. Each expert: replace the old unzipped folder's contents with the new ones
   (same folder), then on `chrome://extensions` / `edge://extensions` click the
   **reload** (↻) icon on the extension card. The saved token/URL are kept.

---

## Notes & gotchas

- **Don't delete the folder** after loading — unpacked extensions run from disk.
- **Developer mode must stay on.** Chrome shows a "Disable developer mode
  extensions" prompt on startup; clicking *Keep* (or just closing it) is fine.
- **Managed browsers** (locked-down org policy) may block unpacked extensions
  entirely. If an expert can't enable Developer mode or load unpacked, that
  machine needs the store + force-install path instead.
- The extension only reports **browser** joins — which is all you need, since
  experts join interviews in the browser.
