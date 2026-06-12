import { useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

// Self-updating dashboard: each build embeds __BUILD_ID__ (vite define) and
// ships a matching /version.json. This guard polls that file (and re-checks
// whenever the tab becomes visible again — the "came back next morning"
// case); on mismatch the page reloads itself, so nobody ever needs
// Ctrl+Shift+R after a deploy. index/version responses are served
// Cache-Control: no-cache (vite preview headers), so a plain reload fetches
// the new bundle.
//
// Safety: a sessionStorage marker per remote buildId stops reload loops if
// something upstream still serves a stale index; a visible tab gets a 5s
// heads-up toast (don't yank a half-filled form), a hidden tab reloads
// silently.

const POLL_MS = 3 * 60 * 1000;
const FIRST_CHECK_MS = 20 * 1000;

export function UpdateGuard() {
  const { toast } = useToast();

  useEffect(() => {
    let stopped = false;

    const check = async () => {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as { buildId?: string } | null;
        const remote = data?.buildId;
        if (!remote || remote === __BUILD_ID__ || stopped) return;

        const onceKey = `update-guard-reloaded-${remote}`;
        if (sessionStorage.getItem(onceKey)) return; // already tried — don't loop
        sessionStorage.setItem(onceKey, '1');

        if (document.visibilityState === 'hidden') {
          window.location.reload();
          return;
        }
        toast({
          title: 'Dashboard updated',
          description: 'Loading the new version in a few seconds…',
          duration: 4500,
        });
        setTimeout(() => window.location.reload(), 5000);
      } catch {
        /* offline / transient — next poll retries */
      }
    };

    const interval = setInterval(check, POLL_MS);
    const first = setTimeout(check, FIRST_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clearInterval(interval);
      clearTimeout(first);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [toast]);

  return null;
}
