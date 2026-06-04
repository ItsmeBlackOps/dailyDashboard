import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * Session flag remembering that we've already force-reloaded the page once in
 * response to a stale-chunk import failure. Guards against an infinite reload
 * loop when the new build genuinely cannot load the chunk.
 */
const RELOAD_FLAG = '__chunk_reloaded';

/**
 * A stale lazy chunk produces a few different error shapes across browsers and
 * bundlers. Match the common ones (Vite/webpack dynamic-import failures) plus
 * the "reading 'default'" shape React surfaces when the resolved module is
 * undefined.
 */
const CHUNK_ERROR_RE =
  /ChunkLoadError|Loading chunk|dynamically imported module|importing a module script failed|reading 'default'/i;

function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: string }).name ?? '';
  const message = (err as { message?: string }).message ?? '';
  return CHUNK_ERROR_RE.test(name) || CHUNK_ERROR_RE.test(message);
}

function readReloadFlag(): boolean {
  try {
    return window.sessionStorage.getItem(RELOAD_FLAG) != null;
  } catch {
    // sessionStorage can throw (private mode, blocked storage). Treat as "not set".
    return false;
  }
}

function setReloadFlag(): void {
  try {
    window.sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    // Ignore — without the flag we simply lose the loop guard.
  }
}

function clearReloadFlag(): void {
  try {
    window.sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // Ignore.
  }
}

/**
 * Drop-in replacement for `React.lazy` that survives stale-chunk failures after
 * a deploy. When a dynamic import rejects because the old chunk filename no
 * longer exists on the server, the browser is holding a stale index.html. We
 * force a single full reload (guarded by a sessionStorage flag) to fetch the
 * fresh index.html + chunk manifest. If the reload has already happened and the
 * import still fails, we rethrow so the route's error boundary can show.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const mod = await factory();
      // Successful load — clear the guard so a *future* stale deploy can reload again.
      clearReloadFlag();
      return mod;
    } catch (err) {
      if (isChunkLoadError(err)) {
        if (!readReloadFlag()) {
          // First stale-chunk failure this tab has seen: reload once to pick up
          // the new build. Return a promise that never settles so React keeps
          // showing the Suspense fallback during the brief reload window
          // instead of flashing the error boundary.
          setReloadFlag();
          window.location.reload();
          return new Promise<{ default: T }>(() => {
            /* never resolves; the page is reloading */
          });
        }
        // Reload already attempted and it still fails — surface to the boundary.
        throw err;
      }
      // Not a chunk-load error: a real bug in the module. Surface it.
      throw err;
    }
  });
}
