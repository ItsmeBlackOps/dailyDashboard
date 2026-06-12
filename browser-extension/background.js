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

async function ensureEnrolled({ apiBase, accessToken }) {
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
    const res = await fetch(`${base}/api/meeting-presence/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || !data.token) {
      return { ok: false, status: res.status };
    }
    await chrome.storage.local.set({ apiBase: base, token: data.token, enrolledAt: Date.now() });
    return { ok: true, enrolled: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

let lastKey = null;
let lastAt = 0;

async function handlePresence({ state, meetingUrl }) {
  const { apiBase, token } = await getConfig();
  if (!apiBase || !token) {
    return { ok: false, error: 'not_enrolled' };
  }

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

  // Detector token rejected — drop it so the next dashboard visit re-enrolls.
  if (res.status === 401) {
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'meeting.presence') {
    handlePresence(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // keep the channel open for the async response
  }
  if (msg && msg.type === 'ensure-enrolled') {
    ensureEnrolled(msg).then(sendResponse).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  return false;
});
