import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ShieldAlert, RefreshCw, Download } from 'lucide-react';
import { useExtensionInstalled } from '@/hooks/useExtensionInstalled';
import { isTechnicalTeam } from '@/lib/technicalTeam';
import {
  EXTENSION_DOWNLOAD_URL,
  extensionsPageUrl,
  MIN_EXTENSION_VERSION,
  meetsMinVersion,
} from '@/lib/meetingDetector';

// HARD gate: technical-team members cannot use the dashboard without the
// Meeting Detector extension at (or above) the required version. A full-screen
// non-dismissible overlay covers everything until the bridge is detected and
// its version passes MIN_EXTENSION_VERSION — outdated installs are blocked the
// same way (the staleness fixes only exist in newer builds, so an old
// extension silently mis-reports meetings).
//
// The /meeting-detector setup page stays reachable (it hosts the same
// download + instructions with the live "detected" chip), and nothing renders
// while detection is still 'checking' (no flash for compliant users).
// Non-technical roles and admins are never gated.
export function ExtensionGate() {
  const role = (typeof localStorage !== 'undefined' && localStorage.getItem('role')) || '';
  const gated = isTechnicalTeam(role);
  const { status, version, recheck } = useExtensionInstalled();
  const location = useLocation();
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  if (!gated) return null;
  if (location.pathname === '/meeting-detector') return null;
  if (status === 'checking') return null;

  const outdated = status === 'installed' && !meetsMinVersion(version);
  if (status === 'installed' && !outdated) return null;

  const extUrl = extensionsPageUrl();
  const copyExtUrl = async () => {
    try {
      await navigator.clipboard.writeText(extUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };
  const handleRecheck = () => {
    setChecking(true);
    recheck();
    setTimeout(() => setChecking(false), 2200);
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-label="Meeting Detector extension required"
    >
      <div className="w-full max-w-lg rounded-xl border border-amber-400/60 bg-card p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-6 w-6 flex-none text-amber-500" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              {outdated
                ? 'Update the Meeting Detector extension to continue'
                : 'Meeting Detector extension required'}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {outdated ? (
                <>
                  Version <strong>{version}</strong> is installed, but{' '}
                  <strong>{MIN_EXTENSION_VERSION}</strong> or newer is required. Download the new
                  build, replace the contents of your extension folder, then reload it on the
                  extensions page (approve the new permission if asked).
                </>
              ) : (
                <>
                  The technical team's dashboard requires the Meeting Detector extension — it marks
                  your interviews <strong>started</strong> automatically when you join the Teams
                  call. You can continue once it's installed in this browser.
                </>
              )}
            </p>

            <ol className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <li>
                1.{' '}
                <a
                  href={EXTENSION_DOWNLOAD_URL}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  <Download className="h-3.5 w-3.5" />
                  Download the extension
                </a>{' '}
                and unzip it {outdated ? 'over your existing folder' : 'to a permanent folder'}.
              </li>
              <li>
                2. Open{' '}
                <button
                  type="button"
                  onClick={copyExtUrl}
                  title="Click to copy, then paste in the address bar"
                  className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-muted/70"
                >
                  {extUrl}
                  <span className="font-sans text-[10px] text-muted-foreground">
                    {copied ? '✓ copied' : 'copy'}
                  </span>
                </button>{' '}
                {outdated ? (
                  <>and click the reload (↻) icon on the extension.</>
                ) : (
                  <>
                    → enable <strong>Developer mode</strong> → <strong>Load unpacked</strong> → pick
                    the folder.
                  </>
                )}
              </li>
              <li>3. Come back to this tab — it unlocks by itself within a couple of seconds.</li>
            </ol>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRecheck}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
                Check again
              </button>
              <span className="text-xs text-muted-foreground">
                Need help? Ask your team lead — this step is mandatory.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
