import { useState, useCallback } from 'react';
import { useAuth, API_URL } from '@/hooks/useAuth';

// Enrollment surface for the Meeting Detector browser extension. The logged-in
// expert mints their long-lived, scoped detector token here and pastes it into
// the extension's setup page.
export default function MeetingDetector() {
  const { authFetch } = useAuth();
  const [token, setToken] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // The extension POSTs to `${dashboardUrl}/api/meeting-presence/report`, which
  // is the API origin — it can differ from the page origin (frontend vs API
  // domain), so hand out API_URL, not window.location.origin.
  const dashboardUrl = API_URL;

  const generate = useCallback(async () => {
    setLoading(true);
    setError('');
    setCopied(false);
    try {
      const res = await authFetch(`${API_URL}/api/meeting-presence/enroll`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.token) {
        throw new Error(data?.error || 'Could not generate a token.');
      }
      setToken(data.token);
    } catch (e: any) {
      setError(e.message || 'Could not generate a token.');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Meeting Detector</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Install the browser extension and connect it here so an interview is marked{' '}
        <strong>started</strong> automatically the moment you join the Teams call in your browser —
        no manual toggle, and it ignores the lobby.
      </p>

      <ol className="mt-6 space-y-2 text-sm text-muted-foreground">
        <li>
          1. Install the <strong>Interview Meeting Detector</strong> extension (see your admin for the
          install link / package).
        </li>
        <li>2. Click <strong>Generate token</strong> below.</li>
        <li>
          3. In the extension's setup page, paste the <strong>Dashboard URL</strong> and the{' '}
          <strong>token</strong>, then click Save.
        </li>
      </ol>

      <div className="mt-6 rounded-lg border bg-card/40 p-4">
        <div className="text-xs font-medium text-muted-foreground">Dashboard URL</div>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 break-all rounded bg-muted/40 px-2 py-1 text-sm">{dashboardUrl}</code>
          <button
            type="button"
            className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
            onClick={() => copy(dashboardUrl)}
          >
            Copy
          </button>
        </div>

        <div className="mt-4 text-xs font-medium text-muted-foreground">Detector token</div>
        {token ? (
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-muted/40 px-2 py-1 text-xs">{token}</code>
            <button
              type="button"
              className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
              onClick={() => copy(token)}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Not generated yet.</p>
        )}

        <button
          type="button"
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          onClick={generate}
          disabled={loading}
        >
          {loading ? 'Generating…' : token ? 'Regenerate token' : 'Generate token'}
        </button>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        The token is tied to your account and stays valid for 90 days. Generating a new one does not
        revoke the old one — regenerate only if you set up the extension on a different browser.
      </p>
    </div>
  );
}
