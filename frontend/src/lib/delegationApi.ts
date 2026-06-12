// C19 + 2026-06-12 redesign — typed wrappers for /api/delegations.

import { parseJsonOrThrow } from './fetchJson';

export type DelegationScope = 'specific' | 'subtree' | 'tasks' | 'day';
export type DelegationStatus = 'pending' | 'active' | 'rejected';

export interface Delegation {
  _id: string;
  ownerEmail: string;
  delegateEmail: string;
  scope: DelegationScope;
  subjectEmails: string[];
  subtreeRootEmail: string | null;
  taskIds?: string[];
  dayDate?: string | null;
  startsAt?: string | null;
  status?: DelegationStatus; // absent on legacy docs = active
  approverEmail?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  rejectedAt?: string | null;
  rejectedBy?: string | null;
  rejectNote?: string | null;
  grantedAt: string;
  grantedBy: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  reason: string;
  source: string;
}

export interface GrantInput {
  ownerEmail?: string;
  delegateEmail: string;
  scope: DelegationScope;
  subjectEmails?: string[];
  subtreeRootEmail?: string | null;
  taskIds?: string[];
  dayDate?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  ttlDays?: number | null;
  reason?: string;
}

export interface TransferInput {
  subjectEmail: string;
  toTeamLeadDisplayName: string;
  reason?: string;
}

export interface MineResponse {
  success: boolean;
  owned: Delegation[];
  delegated: Delegation[];
  pendingOwned?: Delegation[];
}

export interface EligiblePerson {
  email: string;
  role: string;
  team: string | null;
  teamLead?: string | null;
  /** deptExperts only — true when this expert reports to the caller. */
  mine?: boolean;
}

export interface EligibleResponse {
  success: boolean;
  actorRole: string;
  actorTeam: string | null;
  /** Share-matrix peers the caller may delegate to. */
  delegates: EligiblePerson[];
  /** The caller's own reports. */
  myPeople: EligiblePerson[];
  /** Active experts of the caller's department, labeled with their leads. */
  deptExperts: EligiblePerson[];
  /** Peer leads valid as transfer destinations. */
  transferTargets: { email: string; displayName: string }[];
}

export interface PendingApprovalsResponse {
  success: boolean;
  waitingOnMe: Delegation[];
  myRequests: Delegation[];
}

type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function fetchMineDelegations(authFetch: AuthFetch, apiUrl: string): Promise<MineResponse> {
  const res = await authFetch(`${apiUrl}/api/delegations/mine`);
  return parseJsonOrThrow<MineResponse>(res);
}

export async function fetchEligible(authFetch: AuthFetch, apiUrl: string): Promise<EligibleResponse> {
  const res = await authFetch(`${apiUrl}/api/delegations/eligible`);
  return parseJsonOrThrow<EligibleResponse>(res);
}

export async function fetchPendingApprovals(
  authFetch: AuthFetch,
  apiUrl: string,
): Promise<PendingApprovalsResponse> {
  const res = await authFetch(`${apiUrl}/api/delegations/pending-approvals`);
  return parseJsonOrThrow<PendingApprovalsResponse>(res);
}

export async function grantDelegation(
  authFetch: AuthFetch,
  apiUrl: string,
  input: GrantInput,
): Promise<{ success: boolean; delegation: Delegation }> {
  const res = await authFetch(`${apiUrl}/api/delegations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(res);
}

export async function approveDelegation(
  authFetch: AuthFetch,
  apiUrl: string,
  id: string,
): Promise<{ success: boolean; delegation: Delegation }> {
  const res = await authFetch(`${apiUrl}/api/delegations/${id}/approve`, { method: 'POST' });
  return parseJsonOrThrow(res);
}

export async function rejectDelegation(
  authFetch: AuthFetch,
  apiUrl: string,
  id: string,
  note?: string,
): Promise<{ success: boolean; delegation: Delegation }> {
  const res = await authFetch(`${apiUrl}/api/delegations/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: note || '' }),
  });
  return parseJsonOrThrow(res);
}

export async function revokeDelegation(
  authFetch: AuthFetch,
  apiUrl: string,
  id: string,
  reason?: string,
): Promise<{ success: boolean; delegation: Delegation }> {
  const res = await authFetch(`${apiUrl}/api/delegations/${id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: reason || '' }),
  });
  return parseJsonOrThrow(res);
}

export async function transferUser(
  authFetch: AuthFetch,
  apiUrl: string,
  input: TransferInput,
): Promise<{ success: boolean; transfer: { subjectEmail: string; from: string | null; to: string; transferredAt: string; transferredBy: string; reason?: string } }> {
  const res = await authFetch(`${apiUrl}/api/delegations/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow(res);
}

export const TTL_OPTIONS: { label: string; days: number | null }[] = [
  { label: '7 days', days: 7 },
  { label: '15 days', days: 15 },
  { label: '1 month', days: 30 },
  { label: '6 months', days: 180 },
  { label: 'Forever', days: null },
];

/** Plain-words description of what a delegation covers. */
export function describeDelegation(d: Delegation, myEmail?: string): string {
  if (d.scope === 'tasks') {
    const n = (d.taskIds || []).length;
    return `${n} task${n === 1 ? '' : 's'}`;
  }
  if (d.scope === 'day') return `the whole day ${d.dayDate}`;
  if (d.scope === 'subtree') {
    if (d.subtreeRootEmail === d.ownerEmail) {
      return d.ownerEmail === myEmail ? 'your whole dashboard' : `${d.ownerEmail}'s dashboard`;
    }
    return `everyone under ${d.subtreeRootEmail}`;
  }
  const n = (d.subjectEmails || []).length;
  return `${n} selected ${n === 1 ? 'person' : 'people'}`;
}
