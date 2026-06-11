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
})();
