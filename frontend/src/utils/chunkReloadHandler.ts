/**
 * Auto-reload handler for stale dynamic-import chunks.
 *
 * After a deploy, browser tabs that have the OLD index.html still try
 * to fetch the OLD chunk filenames (e.g. JobsListPage-BQY0PDWp.js).
 * Those chunks no longer exist on the new server, so the lazy-import
 * fails with "Failed to fetch dynamically imported module" and the
 * Suspense boundary surfaces an error.
 *
 * Fix: listen for the events Vite + the browser fire on chunk-load
 * failures, and reload the page once. Guard against an infinite loop
 * by recording a sessionStorage flag — we only auto-reload at most
 * once per minute.
 *
 * Mount via attachChunkReloadHandler() in App.tsx (or main.tsx).
 */
const RELOAD_FLAG_KEY = 'chunkReloadAt';
const RELOAD_COOLDOWN_MS = 60 * 1000;

function shouldReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG_KEY) || '0');
    return Date.now() - last > RELOAD_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function reloadOnce() {
  if (!shouldReload()) {
    // eslint-disable-next-line no-console
    console.warn('[chunkReload] suppressed — already reloaded within cooldown');
    return;
  }
  try {
    sessionStorage.setItem(RELOAD_FLAG_KEY, String(Date.now()));
  } catch { /* ignore */ }
  // eslint-disable-next-line no-console
  console.warn('[chunkReload] stale chunk detected, reloading…');
  // location.reload() with no-cache hint via timestamp param so the
  // server returns a fresh index.html with new chunk filenames.
  const url = new URL(window.location.href);
  url.searchParams.set('_r', String(Date.now()).slice(-6));
  window.location.href = url.toString();
}

const STALE_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading chunk \d+ failed/i,
  /ChunkLoadError/i,
];

function isStaleChunkError(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  return STALE_PATTERNS.some((p) => p.test(message));
}

export function attachChunkReloadHandler() {
  if (typeof window === 'undefined') return;

  // Vite-specific signal (fires regardless of error origin).
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault?.();
    reloadOnce();
  });

  // Catches sync errors that bubble to window.
  window.addEventListener('error', (e) => {
    if (isStaleChunkError(e.message) || isStaleChunkError((e.error as Error | undefined)?.message)) {
      reloadOnce();
    }
  });

  // Catches rejected promises (most lazy-imports throw async).
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as Error | string | undefined;
    const msg = typeof reason === 'string' ? reason : reason?.message;
    if (isStaleChunkError(msg)) {
      e.preventDefault?.();
      reloadOnce();
    }
  });
}
