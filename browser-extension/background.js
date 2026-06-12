// Service worker: receives presence transitions from the content script and
// POSTs them to the dashboard with the enrolled detector token. Because the
// extension declares host_permissions for the dashboard origin, these fetches
// are exempt from CORS.

async function getConfig() {
  const { apiBase, token } = await chrome.storage.local.get(['apiBase', 'token']);
  return { apiBase: (apiBase || '').replace(/\/$/, ''), token: token || '' };
}

// Auto-enrollment: the dashboard bridge reads the user's own access token from
// the dashboard's localStorage and hands it here; we exchange it once for a
// long-lived, meeting-presence-scoped detector token and keep it. Re-enroll if
// it's missing, points at a different dashboard, or is older than 60 days.
const ENROLL_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

const LOG = '[MeetingDetector:bg]';

async function postEnroll(base, bearer) {
  const res = await fetch(`${base}/api/meeting-presence/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function ensureEnrolled({ apiBase, accessToken, refreshToken }) {
  const base = (apiBase || '').replace(/\/$/, '');
  if (!base || !accessToken) return { ok: false, error: 'missing_auth' };

  // Remember the API base even if enrollment fails (e.g. token expired before
  // the exchange) so the options page can prefill the right URL.
  await chrome.storage.local.set({ apiBaseHint: base });

  const stored = await chrome.storage.local.get(['apiBase', 'token', 'enrolledAt']);
  const fresh =
    stored.token &&
    stored.apiBase === base &&
    stored.enrolledAt &&
    Date.now() - stored.enrolledAt < ENROLL_MAX_AGE_MS;
  if (fresh) return { ok: true, already: true };

  try {
    console.info(`${LOG} enrolling via ${base}/api/meeting-presence/enroll`);
    let { res, data } = await postEnroll(base, accessToken);

    // The page's access token expires after ~15 minutes; an idle tab can hand
    // us a stale one. Recover by exchanging the page's refresh token for a
    // fresh access token (same endpoint the app itself uses), then retry once.
    let viaRefresh = false;
    if (res.status === 401 && refreshToken) {
      console.info(`${LOG} access token rejected (401) — trying the refresh token`);
      try {
        const rr = await fetch(`${base}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        const rd = await rr.json().catch(() => ({}));
        if (rr.ok && rd && rd.accessToken) {
          viaRefresh = true;
          ({ res, data } = await postEnroll(base, rd.accessToken));
        } else {
          console.warn(`${LOG} refresh failed (HTTP ${rr.status}) — user needs to log in again`);
        }
      } catch (re) {
        console.warn(`${LOG} refresh request error:`, re.message);
      }
    }

    if (!res.ok || !data || !data.token) {
      console.warn(`${LOG} enrollment failed: HTTP ${res.status}`, data && data.error ? `— ${data.error}` : '');
      return { ok: false, status: res.status, error: data && data.error };
    }

    await chrome.storage.local.set({ apiBase: base, token: data.token, enrolledAt: Date.now() });
    console.info(`${LOG} ✅ detector token stored${viaRefresh ? ' (recovered via refresh token)' : ''} for ${data.email || 'user'}`);
    return { ok: true, enrolled: true, viaRefresh };
  } catch (e) {
    console.warn(`${LOG} enrollment network error:`, e.message);
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Per-tab meeting-URL tracking. Teams is an SPA: the meetup-join route (the
// only URL carrying the stable meeting_<id> token) often flashes by in
// milliseconds when a meeting is joined from the Teams calendar, so the
// content script's 2s poll can miss it and end up reporting the PREVIOUS
// meeting's URL. webNavigation events are synchronous with the navigation --
// they never miss it. Stored in storage.session so a service-worker restart
// mid-call keeps the map.
const hasMeetingToken = (url) => {
  let s = url || '';
  try { s = decodeURIComponent(s); } catch (_e) { /* keep raw */ }
  try { s = decodeURIComponent(s); } catch (_e) { /* keep raw */ }
  return /meeting_[A-Za-z0-9_-]+/i.test(s) || /meetup-join/i.test(s);
};

async function rememberTabUrl(tabId, url) {
  if (tabId == null || tabId < 0 || !hasMeetingToken(url)) return;
  try {
    await chrome.storage.session.set({ [`tabMeetingUrl_${tabId}`]: { url, at: Date.now() } });
  } catch (_e) { /* storage.session unavailable -- content capture still works */ }
}

const NAV_FILTER = {
  url: [{ hostSuffix: 'teams.microsoft.com' }, { hostSuffix: 'teams.live.com' }],
};
if (chrome.webNavigation) {
  chrome.webNavigation.onCommitted.addListener(
    (d) => { void rememberTabUrl(d.tabId, d.url); }, NAV_FILTER);
  chrome.webNavigation.onHistoryStateUpdated.addListener(
    (d) => { void rememberTabUrl(d.tabId, d.url); }, NAV_FILTER);
  chrome.webNavigation.onReferenceFragmentUpdated.addListener(
    (d) => { void rememberTabUrl(d.tabId, d.url); }, NAV_FILTER);
}
chrome.tabs.onRemoved.addListener((tabId) => {
  try { void chrome.storage.session.remove(`tabMeetingUrl_${tabId}`); } catch (_e) { /* ignore */ }
});

let lastKey = null;
let lastAt = 0;

async function handlePresence({ state, meetingUrl }, sender) {
  const { apiBase, token } = await getConfig();
  if (!apiBase || !token) {
    console.warn(`${LOG} presence '${state}' dropped — not enrolled yet (open the dashboard while logged in)`);
    return { ok: false, error: 'not_enrolled' };
  }

  // Prefer the tab's last NAVIGATED meeting URL (event-driven, per tab) over
  // the content script's polled capture — back-to-back meetings in one Teams
  // tab otherwise report the previous meeting's URL. Fall back to the content
  // capture when no navigation was tracked (e.g. browser restarted mid-call:
  // storage.session is empty but the content capture survives).
  const tabId = sender && sender.tab ? sender.tab.id : null;
  const contentHasToken = hasMeetingToken(meetingUrl);
  if (tabId != null && tabId >= 0 && !contentHasToken) {
    // Content capture has no token — fall back to the tab's last NAVIGATED
    // meeting URL. (When the content capture DOES carry a token it wins:
    // it is the tab's current truth, while the tracked URL can belong to a
    // PREVIOUS call in the same tab.)
    try {
      const k = `tabMeetingUrl_${tabId}`;
      const got = await chrome.storage.session.get(k);
      const tracked = got && got[k] && got[k].url;
      if (tracked && hasMeetingToken(tracked)) {
        console.info(`${LOG} using tab-navigation meeting url (content capture was empty)`);
        meetingUrl = tracked;
      }
    } catch (_e) { /* keep the content capture */ }
  }
  // A call just ended in this tab — its tracked URL is consumed. Without
  // this, the NEXT meeting joined in the same tab reports the PREVIOUS
  // meeting's URL and the server answers alreadyStarted for the wrong task.
  if (state === 'ended' && tabId != null && tabId >= 0) {
    try { void chrome.storage.session.remove(`tabMeetingUrl_${tabId}`); } catch (_e) { /* ignore */ }
  }
  console.info(`${LOG} reporting presence '${state}' for ${meetingUrl ? meetingUrl.slice(0, 80) : '(no url)'}…`);

  // Collapse duplicate reports of the same state within 30s.
  const key = `${state}|${meetingUrl || ''}`;
  if (key === lastKey && Date.now() - lastAt < 30000) {
    return { ok: true, deduped: true };
  }
  lastKey = key;
  lastAt = Date.now();

  let res;
  let data = {};
  try {
    res = await fetch(`${apiBase}/api/meeting-presence/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ meetingUrl, state }),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    await chrome.storage.local.set({ lastSent: { state, at: Date.now(), ok: false, error: e.message } });
    return { ok: false, error: e.message };
  }

  await chrome.storage.local.set({ lastSent: { state, at: Date.now(), ok: res.ok, result: data } });
  try {
    const tok = (decodeURIComponent(decodeURIComponent(meetingUrl || '')).match(/meeting_[A-Za-z0-9_-]{6}/i) || [''])[0];
    const { reportLog = [] } = await chrome.storage.local.get('reportLog');
    reportLog.unshift({
      at: Date.now(), state, http: res.status, token: tok,
      matched: data && data.matched === true,
      flagged: data && data.flagged === true,
      alreadyStarted: data && data.alreadyStarted === true,
      reason: (data && data.reason) || null,
    });
    await chrome.storage.local.set({ reportLog: reportLog.slice(0, 5) });
  } catch (_e) { /* diagnostics only */ }
  console.info(`${LOG} report '${state}' -> HTTP ${res.status}`, data);

  // Detector token rejected — drop it so the next dashboard visit re-enrolls.
  if (res.status === 401) {
    console.warn(`${LOG} detector token rejected — dropped; will re-enroll on next dashboard visit`);
    await chrome.storage.local.remove(['token', 'enrolledAt']);
  }

  if (state === 'in_call' && res.ok) {
    chrome.action.setBadgeText({ text: '●' });
    chrome.action.setBadgeBackgroundColor({ color: '#1D9E75' });
  } else if (state === 'ended') {
    chrome.action.setBadgeText({ text: '' });
  }

  return { ok: res.ok, status: res.status, data };
}

// MV3 does not inject content scripts into tabs that were already open when
// the extension is installed/updated — exactly the moment a user installs it
// with the dashboard sitting open in another tab. Inject into existing tabs
// once at install/update so enrollment starts without anyone refreshing.
const INJECTIONS = [
  { urls: ['https://dailydf.silverspace.tech/*', 'http://localhost/*'], files: ['dashboard-bridge.js'] },
  { urls: ['https://teams.microsoft.com/*', 'https://teams.live.com/*'], files: ['content.js'] },
];

chrome.runtime.onInstalled.addListener(async () => {
  for (const { urls, files } of INJECTIONS) {
    try {
      const tabs = await chrome.tabs.query({ url: urls });
      for (const tab of tabs) {
        if (!tab.id) continue;
        try {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
        } catch (_e) {
          // tab not injectable (discarded, chrome:// redirect, etc.) — skip
        }
      }
    } catch (_e) {
      // query failure — non-fatal; a tab refresh still works
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'meeting.presence') {
    handlePresence(msg, sender).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // keep the channel open for the async response
  }
  if (msg && msg.type === 'ensure-enrolled') {
    ensureEnrolled(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  return false;
});
