// Pure classifier for the duplicate-meeting cleanup script. No I/O.
// Given a normalized task and the organizer's calendar events within the
// interview window, decide which events are duplicate meetings to cancel,
// keeping the one whose join URL matches the task's persisted link.

function norm(value) {
  return value == null ? '' : String(value).trim();
}
function lc(value) {
  return norm(value).toLowerCase();
}
function joinUrlOf(ev) {
  return norm(ev && ev.onlineMeeting && ev.onlineMeeting.joinUrl);
}

export function classifyTaskMeetings(task, events) {
  const subject = norm(task && task.subject);
  const organizerEmail = lc(task && task.organizerEmail);
  const persistedLink = norm(task && task.persistedLink);
  const list = Array.isArray(events) ? events : [];

  // Strict match: the old createOutlookEvent set the event subject from the
  // task, created an online meeting, and the assigned interviewer was the
  // organizer. Requiring all three keeps unrelated meetings out.
  const matches = list.filter((ev) =>
    ev &&
    ev.isOnlineMeeting === true &&
    lc(ev.organizer && ev.organizer.emailAddress && ev.organizer.emailAddress.address) === organizerEmail &&
    norm(ev.subject) === subject
  );

  if (matches.length <= 1) {
    return { status: 'none', keep: matches[0] || null, duplicates: [], matchCount: matches.length };
  }

  const canonical = persistedLink
    ? matches.filter((ev) => joinUrlOf(ev) === persistedLink)
    : [];

  if (canonical.length === 1) {
    const keep = canonical[0];
    return {
      status: 'duplicates',
      keep,
      duplicates: matches.filter((ev) => ev !== keep),
      matchCount: matches.length,
    };
  }

  // 0 or >1 events match the persisted link — too risky to auto-pick a keeper.
  return {
    status: 'ambiguous',
    keep: null,
    duplicates: [],
    matchCount: matches.length,
    reason: canonical.length === 0
      ? 'no calendar event matches the task persisted join link'
      : 'multiple events match the persisted link',
  };
}
