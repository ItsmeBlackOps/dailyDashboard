// Data hook for the User Management redesign. Fetches the manageable
// users for the current actor, normalizes backend (new) role names to
// legacy tokens via the alias shim, and derives the actor context that
// rolePolicy needs (self display name + the actor's own manager).
//
// No dedicated unit test — exercised through the page tests. The pure,
// independently-tested logic lives in grouping.ts / rolePolicy.ts.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toLegacyRole } from '@/lib/roleAliases';
import { API_URL, useAuth } from '@/hooks/useAuth';
import { deriveDisplayNameFromEmail, formatNameInput } from '@/utils/userNames';
import type { ActorContext } from './rolePolicy';
import type { ManageableUser } from './grouping';

interface UseManageableUsersResult {
  users: ManageableUser[];
  loading: boolean;
  error: string;
  refetch: () => Promise<void>;
  actorContext: ActorContext;
  actorRole: string;
}

const readLocal = (key: string): string => {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

export function useManageableUsers(): UseManageableUsersResult {
  const { authFetch } = useAuth();
  const [users, setUsers] = useState<ManageableUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refetch = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await authFetch(`${API_URL}/api/users/manageable`);
      const data = await res.json();
      if (!data?.success) {
        throw new Error(data?.error || 'Unable to load users');
      }
      const raw: Array<ManageableUser & { team?: string | null }> = Array.isArray(data.users)
        ? data.users
        : [];
      // C20 — translate new role names back to legacy so every legacy
      // comparison (rolePolicy, roleLabels, grouping) keeps working.
      setUsers(raw.map((u) => ({ ...u, role: toLegacyRole(u.role, u.team) })) as ManageableUser[]);
    } catch (err: any) {
      setError(err?.message || 'Failed to load manageable users');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  // Actor context for rolePolicy. selfDisplayName prefers the name
  // derived from the actor's email (matches the page), falling back to
  // a stored displayName; actorManager is the actor's own manager.
  const actorContext = useMemo<ActorContext>(() => {
    const selfFromEmail = formatNameInput(deriveDisplayNameFromEmail(readLocal('email')));
    const selfFromStored = formatNameInput(readLocal('displayName'));
    return {
      selfDisplayName: selfFromEmail || selfFromStored,
      actorManager: formatNameInput(readLocal('manager')),
    };
  }, []);

  const actorRole = useMemo(() => readLocal('role').toLowerCase(), []);

  return { users, loading, error, refetch, actorContext, actorRole };
}
