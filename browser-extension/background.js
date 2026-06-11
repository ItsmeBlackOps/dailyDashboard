// Service worker: receives presence transitions from the content script and
// POSTs them to the dashboard with the enrolled detector token. Because the
// extension declares host_permissions for the dashboard origin, these fetches
// are exempt from CORS.

async function getConfig() {
  const { apiBase, token } = await chrome.storage.local.get(['apiBase', 'token']);
  return { apiBase: (apiBase || '').replace(/\/$/, ''), token: token || '' };
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
  return false;
});
