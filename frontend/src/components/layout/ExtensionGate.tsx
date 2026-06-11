import { useState } from 'react';
import { Link } from 'react-router-dom';
import { X, AlertTriangle } from 'lucide-react';
import { useExtensionInstalled } from '@/hooks/useExtensionInstalled';
import { isTechnicalTeam } from '@/lib/technicalTeam';

// Warn-but-allow: technical-team members without the Meeting Detector extension
// are NOT blocked — they get a non-blocking warning that interviews won't be
// auto-marked as started, with a one-click path to set it up. The notice clears
// itself the moment the extension is detected (live), and can be dismissed for
// the current session. Non-technical users and admins never see it.
export function ExtensionGate() {
  const role = (typeof localStorage !== 'undefined' && localStorage.getItem('role')) || '';
  const gated = isTechnicalTeam(role);
  const { status } = useExtensionInstalled();
  const [dismissed, setDismissed] = useState(false);

  // Only warn once detection has concluded 'missing' (avoids a flash for
  // installed users during the brief initial check).
  if (!gated || status !== 'missing' || dismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-[9998] w-[340px] max-w-[calc(100vw-2rem)] rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-lg dark:border-amber-700/60 dark:bg-amber-950/40">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-amber-600 dark:text-amber-400" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Meeting Detector not installed
          </p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-300/90">
            Without the browser extension, your interviews won't be marked <strong>started</strong>{' '}
            automatically when you join the Teams call. Set it up to enable it.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Link
              to="/meeting-detector"
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              Set up the extension
            </Link>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-md px-2 py-1.5 text-xs text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
            >
              Later
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="ml-auto flex-none rounded p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
