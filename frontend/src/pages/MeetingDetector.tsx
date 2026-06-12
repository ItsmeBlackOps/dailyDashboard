import { useState, useCallback } from 'react';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { EXTENSION_DOWNLOAD_URL } from '@/lib/meetingDetector';

// Setup surface for the Meeting Detector extension. The happy path is now
// zero-touch: download → install → it self-enrolls from your dashboard login.
// A manual token is kept as a fallback for the rare case auto-enroll can't run.
export default function MeetingDetector() {
  const { authFetch } = useAuth();
  const [token, setToken] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState<string>('');

  const generate = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`${API_URL}/api/meeting-presence/enroll`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.token) throw new Error(data?.error || 'Could not generate a token.');
      setToken(data.token);
    } catch (e: any) {
      setError(e.message || 'Could not generate a token.');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  const copy = useCallback(async (text: string, which: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Meeting Detector</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Install the browser extension and your interviews get marked <strong>started</strong>{' '}
        automatically the moment you join the Teams call in your browser. Setup is one step — the
        extension signs itself in using your dashboard login.
      </p>

      <div className="mt-6 rounded-lg border bg-card/40 p-5">
        <ol className="space-y-4 text-sm">
          <li className="flex gap-3">
            <span className="font-semibold text-muted-foreground">1.</span>
            <div>
              <a
                href={EXTENSION_DOWNLOAD_URL}
                className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Download the extension
              </a>
              <p className="mt-2 text-muted-foreground">
                Unzip it to a permanent folder, then in <code className="rounded bg-muted px-1.5 py-0.5 text-xs">chrome://extensions</code>{' '}
                or <code className="rounded bg-muted px-1.5 py-0.5 text-xs">edge://extensions</code> turn on{' '}
                <strong>Developer mode</strong> → <strong>Load unpacked</strong> → pick the folder.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="font-semibold text-muted-foreground">2.</span>
            <div>
              <p>
                That's it. Once it's installed it connects automatically — no token to copy. The amber
                "not installed" reminder disappears within a second or two.
              </p>
            </div>
          </li>
        </ol>
      </div>

      <details className="mt-6 rounded-lg border bg-card/20 p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Manual setup (only if it didn't connect on its own)
        </summary>
        <p className="mt-3 text-xs text-muted-foreground">
          Open the extension's setup page (click its icon → <strong>Open setup</strong>), paste the
          values below, then <strong>Save</strong>.
        </p>

        <div className="mt-3 text-xs font-medium text-muted-foreground">Dashboard URL</div>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 break-all rounded bg-muted/40 px-2 py-1 text-sm">{API_URL}</code>
          <button type="button" className="rounded-md border px-2 py-1 text-xs hover:bg-muted" onClick={() => copy(API_URL, 'url')}>
            {copied === 'url' ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="mt-4 text-xs font-medium text-muted-foreground">Detector token</div>
        {token ? (
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-muted/40 px-2 py-1 text-xs">{token}</code>
            <button type="button" className="rounded-md border px-2 py-1 text-xs hover:bg-muted" onClick={() => copy(token, 'token')}>
              {copied === 'token' ? 'Copied' : 'Copy'}
            </button>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Not generated yet.</p>
        )}

        <button
          type="button"
          className="mt-3 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-60"
          onClick={generate}
          disabled={loading}
        >
          {loading ? 'Generating…' : token ? 'Regenerate token' : 'Generate token'}
        </button>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </details>
    </div>
  );
}
