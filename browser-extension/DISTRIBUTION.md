# Distributing the Interview Meeting Detector (zip / load-unpacked)

This is the manual rollout: package the extension as a zip, share it (Teams /
SharePoint / email), and have each expert load it once. Works in both **Chrome**
and **Edge**.

> Trade-offs of this method: it needs Developer mode, and it does **not**
> auto-update — when a new version ships you re-share the zip and people reload
> it. For a hands-off, auto-updating rollout later, switch to a store listing +
> Intune/Google-Admin force-install (see the team that owns browser policy).

---

## 1. Package it (you, once per release)

From the repo root:

```bash
bash browser-extension/package.sh
```

This writes `browser-extension/dist/interview-meeting-detector-v<version>.zip`
(version is read from `manifest.json`). Share that single zip file.

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

## 3. Connect it (each expert, once)

1. In the dashboard, open **Meeting Detector** in the sidebar.
2. Click **Generate token**.
3. Click the extension icon → **Open setup** (or right-click the icon →
   *Options* / *Extension options*).
4. Paste the **Dashboard URL** and the **token** shown on the page, click **Test
   connection**, then **Save**.

Done. Joining a Teams meeting in the browser now marks the interview as started
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
