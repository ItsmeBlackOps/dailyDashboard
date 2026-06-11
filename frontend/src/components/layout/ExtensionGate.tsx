import { useExtensionInstalled } from '@/hooks/useExtensionInstalled';
import { isTechnicalTeam } from '@/lib/technicalTeam';
import { useAuth } from '@/hooks/useAuth';

// Technical-team members can only use the dashboard with the Meeting Detector
// extension installed. This renders a full-screen, self-clearing install guide
// for them whenever the extension isn't detected. Non-technical users and
// admins are never gated. The guide watches for the extension live, so the
// moment it's installed the overlay disappears on its own.
export function ExtensionGate() {
  const role = (typeof localStorage !== 'undefined' && localStorage.getItem('role')) || '';
  const gated = isTechnicalTeam(role);
  const { status, recheck } = useExtensionInstalled();
  const { logout } = useAuth();

  if (!gated || status === 'installed') {
    return null;
  }

  const verifying = status === 'checking';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-xl border bg-card p-6 shadow-xl">
        <div className="flex items-center gap-2">
          <span
            className={
              'inline-block h-2.5 w-2.5 rounded-full ' +
              (verifying ? 'animate-pulse bg-amber-500' : 'bg-destructive')
            }
          />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {verifying ? 'Verifying meeting detector…' : 'Meeting detector required'}
          </span>
        </div>

        <h1 className="mt-3 text-xl font-semibold">
          {verifying ? 'Checking your browser…' : 'Install the Meeting Detector to continue'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your team uses the Meeting Detector browser extension so interviews are marked
          <strong> started </strong>
          automatically the moment you join the Teams call. The dashboard stays locked until it's
          installed in this browser.
        </p>

        {!verifying && (
          <ol className="mt-4 space-y-2 text-sm">
            <li className="flex gap-2">
              <span className="font-semibold text-muted-foreground">1.</span>
              <span>
                Get the <strong>Interview Meeting Detector</strong> extension from your admin, then load it:
                open <code className="rounded bg-muted px-1.5 py-0.5 text-xs">chrome://extensions</code>, turn on{' '}
                <strong>Developer mode</strong>, click <strong>Load unpacked</strong>, and pick the extension folder.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-muted-foreground">2.</span>
              <span>Come back to this tab — you'll be let in automatically within a second or two.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-muted-foreground">3.</span>
              <span>
                Finish setup once you're in: open <strong>Meeting Detector</strong> in the sidebar and connect your token.
              </span>
            </li>
          </ol>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">Watching for the extension…</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={recheck}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Re-check now
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Reload page
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={logout}
          className="mt-5 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
