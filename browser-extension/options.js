const $ = (id) => document.getElementById(id);

function show(msg, ok) {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status ' + (ok ? 'ok' : 'err');
}

async function load() {
  const { apiBase, token } = await chrome.storage.local.get(['apiBase', 'token']);
  if (apiBase) $('apiBase').value = apiBase;
  if (token) $('token').value = token;
}

function readInputs() {
  return {
    apiBase: $('apiBase').value.trim().replace(/\/$/, ''),
    token: $('token').value.trim(),
  };
}

$('save').addEventListener('click', async () => {
  const { apiBase, token } = readInputs();
  if (!apiBase || !token) {
    return show('Both the dashboard URL and the token are required.', false);
  }
  await chrome.storage.local.set({ apiBase, token });
  show('Saved. You can close this tab and join your meetings.', true);
});

$('test').addEventListener('click', async () => {
  const { apiBase, token } = readInputs();
  if (!apiBase || !token) {
    return show('Enter the dashboard URL and token first.', false);
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
    if (res.ok) {
      await chrome.storage.local.set({ apiBase, token });
      show('Connected — the token works. Setup complete.', true);
    } else if (res.status === 401) {
      show('Token rejected (401). Generate a fresh token in the dashboard.', false);
    } else {
      show(`Unexpected response (${res.status}). Check the dashboard URL.`, false);
    }
  } catch (e) {
    show(`Could not reach the dashboard: ${e.message}`, false);
  }
});

load();
