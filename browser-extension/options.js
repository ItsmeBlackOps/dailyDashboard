const $ = (id) => document.getElementById(id);

const DEFAULT_API_BASE = 'https://dailydb.silverspace.tech';

// Display-only decode of the detector token's JWT payload ({ email, ... }).
function tokenEmail(token) {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).email || '';
  } catch {
    return '';
  }
}

function show(msg, ok) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'statusmsg ' + (ok ? 'ok' : 'err');
}

async function renderStatus() {
  const { apiBase, token, enrolledAt, apiBaseHint } = await chrome.storage.local.get([
    'apiBase', 'token', 'enrolledAt', 'apiBaseHint',
  ]);

  const dot = $('statusDot');
  const title = $('statusTitle');
  const meta = $('statusMeta');

  if (apiBase && token) {
    dot.className = 'dot green';
    title.textContent = 'Connected';
    const email = tokenEmail(token);
    const since = enrolledAt ? new Date(enrolledAt).toLocaleString() : '';
    meta.innerHTML =
      (email ? `Signed in as <code>${email}</code><br/>` : '') +
      `Dashboard API: <code>${apiBase}</code>` +
      (since ? `<br/>Connected since ${since}` : '') +
      '<br/>Join your Teams meetings in this browser as usual — nothing else to do.';
  } else {
    dot.className = 'dot amber';
    title.textContent = 'Not connected yet';
    meta.textContent =
      'Open the dashboard in this browser while logged in — the extension connects automatically within a few seconds. No token needed.';
  }

  // Prefill the manual field with the best-known base.
  if (!$('apiBase').value) {
    $('apiBase').value = apiBase || apiBaseHint || DEFAULT_API_BASE;
  }
  if (token && !$('token').value) {
    $('token').value = token;
  }
}

function readInputs() {
  return {
    apiBase: $('apiBase').value.trim().replace(/\/+$/, ''),
    token: $('token').value.trim(),
  };
}

$('save').addEventListener('click', async () => {
  const { apiBase, token } = readInputs();
  if (!apiBase || !token) {
    return show('Both the dashboard API URL and the token are required.', false);
  }
  await chrome.storage.local.set({ apiBase, token, enrolledAt: Date.now() });
  show('Saved. You can close this tab and join your meetings.', true);
  renderStatus();
});

$('test').addEventListener('click', async () => {
  const { apiBase, token } = readInputs();
  if (!apiBase || !token) {
    return show('Enter the dashboard API URL and token first.', false);
  }
  show('Testing…', true);
  try {
    // A harmless pre_join report against a non-matching URL: it never flips
    // any meeting, so a 200 just proves the token is accepted.
    const res = await fetch(`${apiBase}/api/meeting-presence/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ meetingUrl: 'connection-test', state: 'pre_join' }),
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON => wrong host */ }

    if (res.ok && data) {
      await chrome.storage.local.set({ apiBase, token, enrolledAt: Date.now() });
      show('Connected — the token works. Setup complete.', true);
      renderStatus();
    } else if (res.status === 401) {
      show('Token rejected (401). Generate a fresh token on the dashboard’s Meeting Detector page.', false);
    } else {
      show(
        `Could not reach the dashboard API (HTTP ${res.status}). Check the URL — the API address is ${DEFAULT_API_BASE} — and try again in a minute if a deployment is in progress.`,
        false,
      );
    }
  } catch (e) {
    show(`Could not reach the dashboard API: ${e.message}. Check the URL (${DEFAULT_API_BASE}).`, false);
  }
});

// Live status: re-render when the background worker enrolls in another tab.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.token || changes.apiBase || changes.enrolledAt || changes.apiBaseHint)) {
    renderStatus();
  }
});

renderStatus();
