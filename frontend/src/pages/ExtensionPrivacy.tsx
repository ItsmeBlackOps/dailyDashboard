// Public privacy policy for the Interview Meeting Detector browser
// extension — required by the Chrome Web Store / Edge Add-ons privacy
// tab. Served unauthenticated at /extension-privacy.

export default function ExtensionPrivacy() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10 text-sm leading-relaxed text-foreground">
      <h1 className="text-2xl font-semibold">Interview Meeting Detector — Privacy Policy</h1>
      <p className="mt-1 text-xs text-muted-foreground">Last updated: June 12, 2026</p>

      <h2 className="mt-6 text-base font-semibold">What this extension does</h2>
      <p className="mt-2">
        Interview Meeting Detector is an internal tool for Silverspace / Vizva staff. It detects
        when a signed-in team member has actually joined a Microsoft Teams interview call in their
        browser and notifies our own dashboard so the interview is marked as started. It serves no
        other purpose.
      </p>

      <h2 className="mt-6 text-base font-semibold">Data the extension handles</h2>
      <ul className="mt-2 list-disc space-y-1.5 pl-5">
        <li>
          <strong>Authentication token</strong> — when you are signed in to our dashboard, the
          extension exchanges your session for a narrowly scoped token that can only report meeting
          presence. It is stored locally in your browser's extension storage and sent only to our
          own dashboard API.
        </li>
        <li>
          <strong>Teams meeting URLs and call state</strong> — on Microsoft Teams pages, the
          extension reads the meeting link and whether you are in the lobby or in the call. The
          meeting URL and the state (for example "in call") are sent only to our own dashboard API
          to match the meeting to its interview task. Audio, video, chat, and page content are
          never read or transmitted.
        </li>
      </ul>

      <h2 className="mt-6 text-base font-semibold">What we do NOT do</h2>
      <ul className="mt-2 list-disc space-y-1.5 pl-5">
        <li>No data is sold, shared with, or transferred to any third party.</li>
        <li>No browsing history is collected; navigation is observed only on Teams pages, only to identify the active meeting.</li>
        <li>No analytics, advertising, or tracking of any kind.</li>
        <li>No remote code is loaded or executed.</li>
      </ul>

      <h2 className="mt-6 text-base font-semibold">Storage and retention</h2>
      <p className="mt-2">
        The scoped token and the last few report results are kept in local extension storage and can
        be removed at any time by uninstalling the extension. Meeting-start records live in our
        internal dashboard, governed by our internal data-retention practices.
      </p>

      <h2 className="mt-6 text-base font-semibold">Contact</h2>
      <p className="mt-2">
        Questions about this policy: contact the Silverspace technical team management via the
        dashboard, or the publisher email listed on the store page.
      </p>
    </div>
  );
}
