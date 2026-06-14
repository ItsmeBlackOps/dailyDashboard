// Mock Support API — typed wrappers for /api/mocks.

import { parseJsonOrThrow } from './fetchJson';

export type MockStatus =
  | 'requested' | 'in_progress' | 'scheduling' | 'scheduled'
  | 'meeting_created' | 'connected' | 'completed' | 'cancelled' | 'recruiter_blocker';

export interface ChecklistItem { id: string; label: string; required: boolean; done: boolean; doneAt?: string | null; }
export interface LinkedTaskSnapshot { taskId: string; subject: string; interviewStartAt: string | null; }

export interface MockRequest {
  _id: string;
  candidateId: string;
  candidateName: string;
  candidateEmailId?: string;
  role: string;
  endClient?: string | null;
  linkedTaskSnapshots: LinkedTaskSnapshot[];
  requestedBy: { email: string; name: string };
  expertEmail: string;
  coExpertEmails: string[];
  status: MockStatus;
  checklist: ChecklistItem[];
  callAttempts: { at: string; outcome: string; note?: string }[];
  scheduledAt: string | null;
  scheduleHistory: { from: string; to: string; reason?: string }[];
  blocker?: { raisedAt: string; raisedBy: string; note?: string; resolvedAt?: string | null } | null;
  feedback?: {
    overall: number; verdict: string; strengths?: string; improvements?: string;
    detailedNotes?: string; submittedAt?: string; submittedBy?: string;
  } | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EligibleCandidate {
  candidateId: string; name: string; emailId: string; expert: string;
  recruiter: string; technology: string; branch: string; status: string;
}
export interface InterviewRef {
  taskId: string; subject: string; interviewStartAt: string | null;
  round: string; client: string; status: string;
}

type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

const post = (authFetch: AuthFetch, url: string, body?: unknown) =>
  authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(parseJsonOrThrow);

const patch = (authFetch: AuthFetch, url: string, body?: unknown) =>
  authFetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(parseJsonOrThrow);

export const mockApi = {
  listMocks: (af: AuthFetch, api: string, qs = '') =>
    af(`${api}/api/mocks${qs ? `?${qs}` : ''}`).then(parseJsonOrThrow) as Promise<{ success: boolean; mocks: MockRequest[] }>,
  getMock: (af: AuthFetch, api: string, id: string) =>
    af(`${api}/api/mocks/${id}`).then(parseJsonOrThrow) as Promise<{ success: boolean; mock: MockRequest }>,
  eligibleCandidates: (af: AuthFetch, api: string) =>
    af(`${api}/api/mocks/eligible/candidates`).then(parseJsonOrThrow) as Promise<{ success: boolean; candidates: EligibleCandidate[] }>,
  candidateInterviews: (af: AuthFetch, api: string, emailId: string) =>
    af(`${api}/api/mocks/candidate/${encodeURIComponent(emailId)}/interviews`).then(parseJsonOrThrow) as Promise<{ success: boolean; interviews: InterviewRef[] }>,
  create: (af: AuthFetch, api: string, body: Record<string, unknown>) =>
    post(af, `${api}/api/mocks`, body) as Promise<{ success: boolean; mock: MockRequest }>,
  start: (af: AuthFetch, api: string, id: string) => post(af, `${api}/api/mocks/${id}/start`),
  callAttempt: (af: AuthFetch, api: string, id: string, body: Record<string, unknown>) => post(af, `${api}/api/mocks/${id}/call-attempt`, body),
  schedule: (af: AuthFetch, api: string, id: string, body: Record<string, unknown>) => post(af, `${api}/api/mocks/${id}/schedule`, body),
  raiseBlocker: (af: AuthFetch, api: string, id: string, body: Record<string, unknown>) => post(af, `${api}/api/mocks/${id}/blocker`, body),
  resolveBlocker: (af: AuthFetch, api: string, id: string, body: Record<string, unknown>) => patch(af, `${api}/api/mocks/${id}/blocker`, body),
  toggleChecklist: (af: AuthFetch, api: string, id: string, body: Record<string, unknown>) => patch(af, `${api}/api/mocks/${id}/checklist`, body),
  markConnected: (af: AuthFetch, api: string, id: string) => post(af, `${api}/api/mocks/${id}/connected`),
  submitFeedback: (af: AuthFetch, api: string, id: string, body: Record<string, unknown>) => post(af, `${api}/api/mocks/${id}/feedback`, body),
  cancel: (af: AuthFetch, api: string, id: string, body: Record<string, unknown>) => post(af, `${api}/api/mocks/${id}/cancel`, body),
};

export const STATUS_LABEL: Record<string, string> = {
  requested: 'Requested',
  in_progress: 'In progress',
  scheduling: 'Scheduling',
  scheduled: 'Scheduled',
  meeting_created: 'Meeting created',
  connected: 'Connected',
  completed: 'Completed',
  cancelled: 'Cancelled',
  recruiter_blocker: 'Blocked',
};
