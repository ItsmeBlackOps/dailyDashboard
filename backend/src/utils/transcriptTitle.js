import { Query } from 'node-appwrite';

// Subjects/titles look like:
//   "Interview Support - <Candidate> - <Role> - Jun 11, 2026 at 03:30 PM EST"
// The trailing time reflects the MEETING start, which changes when a meeting
// is rescheduled — while the task subject keeps the originally scheduled
// time. Exact title equality therefore misses legitimately matching
// transcripts (observed in prod: task "… at 11:00 AM EST" vs transcript
// "… at 03:30 PM EST", same candidate/role/date). The date-level prefix
// (everything before the final " at ") identifies the interview.
export function transcriptTitlePrefix(value = '') {
  const s = String(value ?? '').trim();
  const i = s.lastIndexOf(' at ');
  return (i > 0 ? s.slice(0, i) : s).trim();
}

// Exact-title lookup with a reschedule-tolerant fallback: when no transcript
// carries the exact title, take the NEWEST transcript whose title shares the
// date-level prefix. Returns the raw Appwrite document or null. Never throws.
export async function findTranscriptByTitle(databases, databaseId, collectionId, rawTitle, logger) {
  const title = (rawTitle || '').toString().trim();
  if (!title) {
    return null;
  }

  try {
    const exact = await databases.listDocuments(
      databaseId,
      collectionId,
      [Query.equal('title', title), Query.limit(1)]
    );
    if (exact?.documents?.length > 0) {
      return exact.documents[0];
    }
  } catch (error) {
    logger?.warn?.('Transcript exact-title lookup failed', { title, error: error.message });
    return null;
  }

  const prefix = transcriptTitlePrefix(title);
  if (!prefix || prefix === title) {
    return null;
  }

  try {
    const fallback = await databases.listDocuments(
      databaseId,
      collectionId,
      [Query.startsWith('title', prefix), Query.orderDesc('$createdAt'), Query.limit(1)]
    );
    if (fallback?.documents?.length > 0) {
      logger?.info?.('Transcript matched by prefix fallback (rescheduled meeting)', {
        title,
        matchedTitle: fallback.documents[0].title,
      });
      return fallback.documents[0];
    }
  } catch (error) {
    // startsWith may be unsupported by older Appwrite servers — degrade to
    // exact-only behavior rather than failing the caller.
    logger?.warn?.('Transcript prefix lookup failed (non-fatal)', { title, error: error.message });
  }

  return null;
}
