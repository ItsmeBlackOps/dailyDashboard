// A Teams join URL embeds a stable meeting thread token, e.g.
//   https://teams.microsoft.com/l/meetup-join/19%3ameeting_<ID>%40thread.v2/0?context=...
// The `meeting_<ID>` token is identical whether the surrounding ':' / '@' are
// URL-encoded or not, so it's the reliable key to correlate the meeting the
// expert opened with the task that stored its join URL — far more robust than
// matching the full URL or the title (titles drift on reschedule).
export function extractMeetingThreadId(url = '') {
  if (!url || typeof url !== 'string') return null;
  let s = url;
  // decode up to twice (stored links are sometimes double-encoded)
  for (let i = 0; i < 2; i++) {
    try {
      const d = decodeURIComponent(s);
      if (d === s) break;
      s = d;
    } catch {
      break;
    }
  }
  const m = s.match(/meeting_[A-Za-z0-9_-]+/i);
  return m ? m[0] : null;
}

// Escape a token for safe use inside a MongoDB $regex.
export function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
