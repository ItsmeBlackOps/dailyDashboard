import { useState } from 'react';
import { EXTENSION_DOWNLOAD_URL, extensionsPageUrl } from '@/lib/meetingDetector';
import { useExtensionInstalled } from '@/hooks/useExtensionInstalled';

// Setup surface for the Meeting Detector extension. Fully zero-touch:
// download → install → it signs itself in from your dashboard login. No
// tokens, no URLs. The status chip below flips live when the extension is
// detected in this browser.
export default function MeetingDetector() {
  const { status } = useExtensionInstalled();
  const extUrl = extensionsPageUrl();
  const [copied, setCopied] = useState(false);

  const copyExtUrl = async () => {
    try {
      await navigator.clipboard.writeText(extUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Meeting Detector</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Install the browser extension and your interviews get marked <strong>started</strong>{' '}
        automatically the moment you join the Teams call in your browser. It sets itself up using
        your dashboard login — nothing to configure.
      </p>

      <div className="mt-4 flex items-center gap-2 text-sm">
        <span
          className={
            'inline-block h-2.5 w-2.5 rounded-full ' +
            (status === 'installed'
              ? 'bg-emerald-500'
              : status === 'checking'
                ? 'animate-pulse bg-amber-500'
                : 'bg-muted-foreground/40')
          }
        />
        <span className="text-muted-foreground">
          {status === 'installed'
            ? 'Extension detected in this browser — you are all set.'
            : status === 'checking'
              ? 'Checking this browser for the extension…'
              : 'Extension not detected in this browser yet.'}
        </span>
      </div>

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
                Unzip it to a permanent folder, then open{' '}
                <button
                  type="button"
                  onClick={copyExtUrl}
                  title="Click to copy, then paste in the address bar (browsers don't allow direct links to this page)"
                  className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-muted/70"
                >
                  {extUrl}
                  <span className="text-[10px] font-sans text-muted-foreground">{copied ? '✓ copied' : 'copy'}</span>
                </button>{' '}
                (click to copy, paste in the address bar), turn on <strong>Developer mode</strong> →{' '}
                <strong>Load unpacked</strong> → pick the folder.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="font-semibold text-muted-foreground">2.</span>
            <p>
              That's it. Keep this dashboard open for a few seconds — the extension signs itself in
              automatically and the status above turns green.
            </p>
          </li>
        </ol>
      </div>
    </div>
  );
}
