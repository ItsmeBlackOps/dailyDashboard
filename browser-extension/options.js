const $ = (id) => document.getElementById(id);

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

async function renderStatus() {
  const { apiBase, token, enrolledAt } = await chrome.storage.local.get([
    'apiBase', 'token', 'enrolledAt',
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
      'Open the dashboard in this browser while logged in — the extension connects automatically within a few seconds.';
  }
}

// Live status: the background worker enrolls while a dashboard tab is open;
// re-render the instant that lands.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.token || changes.apiBase || changes.enrolledAt)) {
    renderStatus();
  }
});

renderStatus();
