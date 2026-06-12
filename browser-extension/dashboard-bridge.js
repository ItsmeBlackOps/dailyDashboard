// Runs on the Daily Dashboard origin. Lets the dashboard page detect that the
// extension is installed, via a window.postMessage handshake (no extension ID
// needed). The dashboard's gate pings; we pong. We also announce on load in
// case the page is already listening.
(() => {
  const FROM_EXT = 'meeting-detector-extension';
  const FROM_PAGE = 'meeting-detector-page';

  function version() {
    try { return chrome.runtime.getManifest().version; } catch { return 'unknown'; }
  }

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

  // Announce now and again shortly after, so a page that mounts its listener a
  // beat later still hears us even without pinging.
  announce('present');
  setTimeout(() => announce('present'), 800);

  // Auto-enroll: read the dashboard's OWN auth from localStorage (the access
  // token it already stores) plus the API base it writes for us, and hand them
  // to the background worker, which exchanges them for the detector token. No
  // manual token copy-paste. We poll (rather than a fixed retry window) because
  // sign-in can complete via SPA navigation after this script has loaded, with
  // no page reload — so the token may appear minutes later. ensure-enrolled is
  // idempotent (the background no-ops on a fresh token), and we stop polling
  // once it reports success.
  let enrollTimer = null;

  function tryEnroll() {
    let accessToken = null;
    let apiBase = null;
    try {
      accessToken = window.localStorage.getItem('accessToken');
      apiBase = window.localStorage.getItem('md_api_base');
    } catch {
      return;
    }
    if (!accessToken || !apiBase) return;
    try {
      chrome.runtime.sendMessage({ type: 'ensure-enrolled', apiBase, accessToken }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp && resp.ok && enrollTimer) {
          clearInterval(enrollTimer);
          enrollTimer = null;
        }
      });
    } catch {
      /* extension context invalidated */
    }
  }

  tryEnroll();
  enrollTimer = setInterval(tryEnroll, 4000);
})();
