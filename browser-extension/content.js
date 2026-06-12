// Runs on Teams meeting pages. Watches the DOM and reports state transitions
// to the background worker. The whole point: fire "in_call" ONLY when the
// expert is actually admitted into the live call — never for pre-join or the
// lobby. We require two independent in-call markers AND the absence of any
// lobby text, held stable for a few seconds, to avoid false positives from
// Teams' constant re-rendering.
(() => {
  const POLL_MS = 2000;
  const STABLE_TICKS = 2; // a state must persist ~4s before we report it

  let capturedMeetingUrl = /meetup-join|meeting_/i.test(location.href) ? location.href : null;
  let lastReported = null;
  let stableState = null;
  let stableCount = 0;

  const has = (sel) => {
    try { return !!document.querySelector(sel); } catch { return false; }
  };
  const bodyText = () => (document.body && document.body.innerText) || '';

  // Grab the meetup-join URL early — it carries the stable meeting_<id> token
  // the backend matches on. Teams' SPA navigates away after join, so keep the
  // first good URL we see for the rest of the session.
  function captureMeetingUrl() {
    const href = location.href;
    if (/meetup-join|meeting_/i.test(href)) {
      capturedMeetingUrl = href;
      return;
    }
    // Anchor fallback ONLY when nothing is captured yet — chat messages and
    // calendar entries contain OTHER meetings' join links, and overwriting a
    // good capture with the first anchor in the DOM reported wrong meetings.
    if (capturedMeetingUrl) return;
    const a = document.querySelector('a[href*="meetup-join"], a[href*="meeting_"]');
    if (a && a.href) capturedMeetingUrl = a.href;
  }

  function detectState() {
    const text = bodyText();

    // Lobby / waiting room — explicitly ignored. Check this first.
    const lobby =
      /waiting (for|to be)|let you in|someone .{0,40}admit|when the meeting starts|you're in the lobby|in the lobby/i.test(text) ||
      has('[data-tid="lobby-screen"]') ||
      has('[data-tid*="lobby" i]');
    if (lobby) return 'lobby';

    // In-call: the leave/hang-up control only exists once admitted, paired
    // with a second live-call marker (call timer or the participant roster).
    const leaveControl =
      has('[data-tid="hangup-main-btn"]') ||
      has('[data-tid="call-hangup"]') ||
      has('[data-tid*="hangup" i]') ||
      has('button[aria-label*="Leave" i]') ||
      has('button[aria-label*="Hang up" i]');
    const secondMarker =
      has('[data-tid="call-duration"]') ||
      has('#call-duration-custom') ||
      has('[data-tid="roster-button"]') ||
      has('[data-tid="people-button"]') ||
      has('[aria-label*="meeting controls" i]') ||
      has('[data-tid="calling-mute-button"]');
    if (leaveControl && secondMarker) return 'in_call';

    // Pre-join device screen — informational only.
    const prejoin =
      has('[data-tid="prejoin-join-button"]') ||
      has('button[aria-label*="Join now" i]') ||
      /\bjoin now\b/i.test(text);
    if (prejoin) return 'pre_join';

    return 'idle';
  }

  function report(state) {
    console.info('[MeetingDetector] Teams state →', state, '| meeting url:', (capturedMeetingUrl || '').slice(0, 80));
    try {
      chrome.runtime.sendMessage({ type: 'meeting.presence', state, meetingUrl: capturedMeetingUrl }, (resp) => {
        if (chrome.runtime.lastError) {
          console.warn('[MeetingDetector] report not delivered:', chrome.runtime.lastError.message);
          return;
        }
        console.info('[MeetingDetector] report result:', resp);
      });
    } catch (_e) {
      // extension reloaded / context invalidated — ignore
    }
  }

  function tick() {
    captureMeetingUrl();
    const s = detectState();

    if (s === stableState) {
      stableCount += 1;
    } else {
      stableState = s;
      stableCount = 1;
    }

    if (stableCount === STABLE_TICKS && s !== lastReported) {
      const prev = lastReported;
      lastReported = s;

      let reportState = s;
      if (s === 'idle') {
        if (prev === 'in_call') reportState = 'ended';
        else return; // idle that didn't follow a call — nothing to report
      }
      report(reportState);
      // The captured URL belongs to the call that just ended — drop it so the
      // NEXT meeting joined in this same tab must capture (or be tracked by
      // the background's navigation listener) fresh, never re-reported stale.
      if (reportState === 'ended') capturedMeetingUrl = null;
    }
  }

  captureMeetingUrl();
  setInterval(tick, POLL_MS);
})();
