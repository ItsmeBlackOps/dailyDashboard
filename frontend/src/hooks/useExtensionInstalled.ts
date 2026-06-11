import { useCallback, useEffect, useRef, useState } from 'react';

export type ExtensionStatus = 'checking' | 'installed' | 'missing';

const FROM_EXT = 'meeting-detector-extension';
const FROM_PAGE = 'meeting-detector-page';

// Detects the Meeting Detector browser extension via a window.postMessage
// handshake with its dashboard-bridge content script. No extension ID needed.
// Keeps polling so that installing the extension later flips the status to
// `installed` in real time (drives the live install guide).
export function useExtensionInstalled() {
  const [status, setStatus] = useState<ExtensionStatus>('checking');
  const [version, setVersion] = useState<string>('');
  const settled = useRef(false);
  const [nonce, setNonce] = useState(0);

  const ping = useCallback(() => {
    try {
      window.postMessage({ source: FROM_PAGE, type: 'ping' }, window.location.origin);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    settled.current = false;

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const d = event.data;
      if (d && d.source === FROM_EXT && (d.type === 'present' || d.type === 'pong')) {
        settled.current = true;
        setVersion(typeof d.version === 'string' ? d.version : '');
        setStatus('installed');
      }
    };
    window.addEventListener('message', onMessage);

    // Fast initial probes (installed extensions answer within ~150ms), then a
    // slow keep-alive poll so a later install is detected live.
    ping();
    const quick = [120, 350, 700, 1200].map((ms) => window.setTimeout(ping, ms));
    const decide = window.setTimeout(() => {
      if (!settled.current) setStatus('missing');
    }, 1800);
    const poll = window.setInterval(() => {
      if (!settled.current) ping();
    }, 1500);

    return () => {
      window.removeEventListener('message', onMessage);
      quick.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(decide);
      window.clearInterval(poll);
    };
  }, [ping, nonce]);

  const recheck = useCallback(() => {
    setStatus('checking');
    setNonce((n) => n + 1);
  }, []);

  return { status, version, recheck };
}
