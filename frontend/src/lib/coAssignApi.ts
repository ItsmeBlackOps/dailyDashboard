// Co-experts on a task (2026-06-12 redesign) — typed wrappers for
// /api/tasks/:taskId/co-assignees. Authority rules live server-side:
// admin / the expert's own lead add instantly; cross-squad adds and
// expert requests land pending with the expert's lead as approver.

import { parseJsonOrThrow } from './fetchJson';

export interface PendingCoAssign {
  email: string;
  requestedBy: string;
  requestedAt: string;
  approverEmail: string;
}

export interface CoAssignResult {
  success: boolean;
  status: 'added' | 'pending' | 'rejected' | 'removed';
  approverEmail?: string;
  already?: boolean;
}

type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function addCoAssignee(
  authFetch: AuthFetch, apiUrl: string, taskId: string, email: string,
): Promise<CoAssignResult> {
  const res = await authFetch(`${apiUrl}/api/tasks/${taskId}/co-assignees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  return parseJsonOrThrow(res);
}

export async function approveCoAssignee(
  authFetch: AuthFetch, apiUrl: string, taskId: string, email: string,
): Promise<CoAssignResult> {
  const res = await authFetch(
    `${apiUrl}/api/tasks/${taskId}/co-assignees/${encodeURIComponent(email)}/approve`,
    { method: 'POST' },
  );
  return parseJsonOrThrow(res);
}

export async function rejectCoAssignee(
  authFetch: AuthFetch, apiUrl: string, taskId: string, email: string, note?: string,
): Promise<CoAssignResult> {
  const res = await authFetch(
    `${apiUrl}/api/tasks/${taskId}/co-assignees/${encodeURIComponent(email)}/reject`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note || '' }),
    },
  );
  return parseJsonOrThrow(res);
}

export async function removeCoAssignee(
  authFetch: AuthFetch, apiUrl: string, taskId: string, email: string,
): Promise<CoAssignResult> {
  const res = await authFetch(
    `${apiUrl}/api/tasks/${taskId}/co-assignees/${encodeURIComponent(email)}`,
    { method: 'DELETE' },
  );
  return parseJsonOrThrow(res);
}
