/**
 * Compact human-readable "time since" string.
 *
 *   <1 min   → "Just now"
 *   <60 min  → "5m ago"
 *   <24 hr   → "3h ago"
 *   ≥ 24 hr  → "Apr 12" (locale month + day)
 *
 * Used by the notifications dropdown in the header and the standalone
 * /notifications page. Returns "" for inputs that don't parse to a
 * valid date.
 */
export function timeAgo(timestamp: string | number | Date): string {
  const date = new Date(timestamp);
  const t = date.getTime();
  if (Number.isNaN(t)) return '';
  const diffMs = Date.now() - t;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
