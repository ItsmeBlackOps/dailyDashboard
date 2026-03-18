/**
 * Centralized error tracking utility.
 *
 * Sends structured error events to PostHog with user context and task metadata
 * so every error is fully debuggable from the PostHog dashboard.
 *
 * Usage:
 *   trackError('Failed to persist mock materials', error, {
 *     candidate_email: entry.candidateEmail,
 *     source_task_id: entry.sourceTaskId,
 *   });
 */
import posthog from 'posthog-js';

export interface ErrorMeta {
  [key: string]: unknown;
}

export function trackError(label: string, error: unknown, meta?: ErrorMeta): void {
  // Always log to console first so local dev still works
  console.error(label, error);

  try {
    // Pull user context from localStorage (set during sign-in)
    const userEmail =
      (localStorage.getItem('email') || '').trim().toLowerCase() || undefined;
    const userRole = localStorage.getItem('role') || undefined;
    const userBranch = localStorage.getItem('branch') || undefined;
    const userDisplayName = localStorage.getItem('displayName') || undefined;

    // Normalize the error object
    const errorMessage =
      error instanceof Error ? error.message : String(error ?? 'unknown error');
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorStack = error instanceof Error ? error.stack : undefined;

    posthog.capture('app_error', {
      // Error identity
      label,
      error_name: errorName,
      error_message: errorMessage,
      error_stack: errorStack,

      // Who triggered it
      user_email: userEmail,
      user_role: userRole,
      user_branch: userBranch,
      user_display_name: userDisplayName,

      // Where it happened
      page_url: window.location.href,
      timestamp: new Date().toISOString(),

      // Caller-supplied context (task, candidate, file info, etc.)
      ...meta,
    });
  } catch {
    // Never let the tracker itself break the app
  }
}
