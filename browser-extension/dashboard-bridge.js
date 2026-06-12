// Runs on the Daily Dashboard origin. Two jobs:
//  1. Answer the page's "is the extension installed?" ping (postMessage).
//  2. Auto-enroll: read the dashboard's own auth from localStorage and hand it
//     to the background worker, which exchanges it for the detector token.
// All steps log to the page console with the [MeetingDetector] prefix so a
// stuck enrollment is diagnosable from DevTools.
(() => {
  const FROM_EXT = 'meeting-detector-extension';
  const FROM_PAGE = 'meeting-detector-page';
  const LOG = '[MeetingDetector]';

  // Fallback when the page bundle predates the md_api_base write (stale cached
  // frontend): the production API base is fixed, so enrollment must not depend
  // on the page being fresh. Local dev pages talk to a local API.
  const FALLBACK_API_BASE = window.location.hostname === 'localhost'
    ? window.location.origin.replace(/:\d+$/, ':3004')
    : 'https://dailydb.silverspace.tech';

  function version() {
    try { return chrome.runtime.getManifest().version; } catch { return 'unknown'; }
  }

  console.info(`${LOG} bridge injected (v${version()}) on ${window.location.origin}`);

  function announce(type) {
    window.postMessage({ source: FROM_EXT, type, version: version() }, window.location.origin);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (data && data.source === FROM_PAGE && data.type === 'ping') {
      announce('pong');
    }
  });

  announce('present');
  setTimeout(() => announce('present'), 800);

  // ---- auto-enroll ----
  let enrollTimer = null;
  let attempt = 0;
  let lastLogged = ''; // avoid spamming the same condition every 4s

  function logOnce(key, fn) {
    if (lastLogged !== key) {
      lastLogged = key;
      fn();
    }
  }

  function tryEnroll() {
    let accessToken = null;
    let refreshToken = null;
    let apiBase = null;
    try {
      accessToken = window.localStorage.getItem('accessToken');
      refreshToken = window.localStorage.getItem('refreshToken');
      apiBase = window.localStorage.getItem('md_api_base') || FALLBACK_API_BASE;
    } catch (e) {
      logOnce('ls-blocked', () => console.warn(`${LOG} cannot read localStorage:`, e.message));
      return;
    }

    if (!accessToken) {
      logOnce('no-token', () => console.info(`${LOG} waiting for login — no accessToken in localStorage yet (polling every 4s)`));
      return;
    }

    attempt += 1;
    logOnce('sending', () => console.info(`${LOG} attempting enrollment via ${apiBase} (have refreshToken: ${Boolean(refreshToken)})`));

    try {
      chrome.runtime.sendMessage(
        { type: 'ensure-enrolled', apiBase, accessToken, refreshToken },
        (resp) => {
          if (chrome.runtime.lastError) {
            logOnce('sw-err', () => console.warn(`${LOG} background worker unreachable:`, chrome.runtime.lastError.message));
            return;
          }
          if (resp && resp.ok) {
            console.info(`${LOG} ✅ enrolled${resp.already ? ' (already had a fresh token)' : ''}${resp.viaRefresh ? ' (recovered via refresh token)' : ''} — detector active for this browser`);
            if (enrollTimer) { clearInterval(enrollTimer); enrollTimer = null; }
          } else {
            const why = resp ? (resp.error || `HTTP ${resp.status}`) : 'no response';
            logOnce(`fail-${why}`, () => console.warn(`${LOG} enrollment attempt ${attempt} failed: ${why} — will keep retrying every 4s`));
          }
        }
      );
    } catch (e) {
      logOnce('ctx', () => console.warn(`${LOG} extension context invalidated (reloaded?). Refresh this tab.`, e.message));
    }
  }

  tryEnroll();
  enrollTimer = setInterval(tryEnroll, 4000);
})();
