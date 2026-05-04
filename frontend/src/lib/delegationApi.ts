// C19 — typed wrappers for /api/delegations.

import { parseJsonOrThrow } from './fetchJson';

export type DelegationScope = 'specific' | 'subtree';

export interface Delegation {
  _id: string;
  ownerEmail: string;
  delegateEmail: string;
  scope: DelegationScope;
  subjectEmails: string[];
  subtreeRootEmail: string | null;
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
  ttlDays: number | null;
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
}

export async function fetchMineDelegations(
  authFetch: (url: string, init?: RequestInit) => Promise<Response>,
  apiUrl: string,
): Promise<MineResponse> {
  const res = await authFetch(`${apiUrl}/api/delegations/mine`);
  return parseJsonOrThrow<MineResponse>(res);
}

export async function grantDelegation(
  authFetch: (url: string, init?: RequestInit) => Promise<Response>,
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

export async function revokeDelegation(
  authFetch: (url: string, init?: RequestInit) => Promise<Response>,
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
  authFetch: (url: string, init?: RequestInit) => Promise<Response>,
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
