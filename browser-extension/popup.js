const $ = (id) => document.getElementById(id);

(async () => {
  const { apiBase, token, lastSent } = await chrome.storage.local.get(['apiBase', 'token', 'lastSent']);
  const enrolled = Boolean(apiBase && token);

  $('enrollDot').className = 'dot ' + (enrolled ? 'green' : 'gray');
  $('enroll').textContent = enrolled ? 'Connected to dashboard' : 'Not set up yet';

  if (lastSent && lastSent.state) {
    const when = lastSent.at ? new Date(lastSent.at).toLocaleTimeString() : '';
    const label = lastSent.state === 'in_call' ? 'In call (reported)' : lastSent.state;
    $('last').textContent = `${label}${when ? ' · ' + when : ''}`;
    $('last').style.color = lastSent.ok ? '#0F6E56' : '#A32D2D';
  }

  $('setup').addEventListener('click', () => chrome.runtime.openOptionsPage());
})();
