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
  const { apiBase, token, lastSent, reportLog } = await chrome.storage.local.get(['apiBase', 'token', 'lastSent', 'reportLog']);
  const enrolled = Boolean(apiBase && token);

  $('enrollDot').className = 'dot ' + (enrolled ? 'green' : 'gray');
  const email = enrolled ? tokenEmail(token) : '';
  $('enroll').textContent = enrolled
    ? (email ? `Connected as ${email}` : 'Connected to dashboard')
    : 'Not connected — open (or refresh) the dashboard while logged in';

  if (lastSent && lastSent.state) {
    const when = lastSent.at ? new Date(lastSent.at).toLocaleTimeString() : '';
    const label = lastSent.state === 'in_call' ? 'In call (reported)' : lastSent.state;
    $('last').textContent = `${label}${when ? ' · ' + when : ''}`;
    $('last').style.color = lastSent.ok ? '#0F6E56' : '#A32D2D';
  }

  // Per-report verdicts (last 5) — shows exactly what the dashboard said
  // for each report: started / already started / wrong-or-no meeting match.
  const log = Array.isArray(reportLog) ? reportLog : [];
  const logEl = $('log');
  if (logEl && log.length > 0) {
    logEl.innerHTML = '';
    for (const r of log) {
      const when = r.at ? new Date(r.at).toLocaleTimeString() : '';
      let verdict;
      if (r.state !== 'in_call') verdict = r.state;
      else if (r.flagged) verdict = '✅ marked started';
      else if (r.alreadyStarted) verdict = 'already started';
      else if (r.reason === 'no_task') verdict = '⚠ no matching task';
      else if (r.reason === 'no_meeting_id') verdict = '⚠ no meeting id in url';
      else if (r.http !== 200) verdict = '⚠ HTTP ' + r.http;
      else verdict = 'sent';
      const div = document.createElement('div');
      div.className = 'logrow';
      div.textContent = `${when} · ${verdict}${r.token ? ' · ' + r.token : ''}`;
      logEl.appendChild(div);
    }
  }

  $('setup').addEventListener('click', () => chrome.runtime.openOptionsPage());
})();
