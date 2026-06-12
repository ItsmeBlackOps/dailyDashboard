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
