const $ = (id) => document.getElementById(id);

function tokenEmail(token) {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json).email || '';
  } catch {
    return '';
  }
}

(async () => {
  const { apiBase, token, lastSent } = await chrome.storage.local.get(['apiBase', 'token', 'lastSent']);
  const enrolled = Boolean(apiBase && token);

  $('enrollDot').className = 'dot ' + (enrolled ? 'green' : 'gray');
  const email = enrolled ? tokenEmail(token) : '';
  $('enroll').textContent = enrolled
    ? (email ? `Connected as ${email}` : 'Connected to dashboard')
    : 'Not connected — open the dashboard once';

  if (lastSent && lastSent.state) {
    const when = lastSent.at ? new Date(lastSent.at).toLocaleTimeString() : '';
    const label = lastSent.state === 'in_call' ? 'In call (reported)' : lastSent.state;
    $('last').textContent = `${label}${when ? ' · ' + when : ''}`;
    $('last').style.color = lastSent.ok ? '#0F6E56' : '#A32D2D';
  }

  $('setup').addEventListener('click', () => chrome.runtime.openOptionsPage());
})();
