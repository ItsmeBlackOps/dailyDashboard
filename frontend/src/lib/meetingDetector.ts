// Stable public download for the Meeting Detector browser extension zip. The
// `...-latest.zip` object is overwritten on each release by
// backend/scripts/uploadExtensionZip.mjs, so this URL never changes.
export const EXTENSION_DOWNLOAD_URL =
  'https://egvjgtfjstxgszpzvvbx.supabase.co/storage/v1/object/public/resumes/extensions/interview-meeting-detector-latest.zip';

// Browsers block web pages from NAVIGATING to chrome:// / edge:// URLs (a
// privileged-scheme security rule), so we can't hyperlink the extensions page.
// Next best: show the right URL for THIS browser as click-to-copy.
export function extensionsPageUrl(): string {
  return typeof navigator !== 'undefined' && /Edg\//.test(navigator.userAgent)
    ? 'edge://extensions'
    : 'chrome://extensions';
}

// Minimum extension version the hard gate accepts. Bump when an extension
// release carries a fix the org depends on (e.g. 1.7.0's stale-URL fix) —
// older installs are then blocked until updated.
export const MIN_EXTENSION_VERSION = '1.7.0';

/** Numeric segment-wise compare: '1.10.0' >= '1.7.0'. Unknown/blank → false. */
export function meetsMinVersion(
  version: string | null | undefined,
  min: string = MIN_EXTENSION_VERSION,
): boolean {
  if (!version) return false;
  const a = version.split('.').map((n) => parseInt(n, 10) || 0);
  const b = min.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return true;
}
