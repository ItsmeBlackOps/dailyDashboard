// Pure filter / sort / group helpers for the User Management table.
// No React, no I/O — fully unit-testable. The data hook
// (useManageableUsers) feeds these; the page renders the output.

import { deriveDisplayNameFromEmail } from '@/utils/userNames';

export interface ManageableUser {
  email: string;
  role: string;
  teamLead?: string;
  manager?: string;
  active: boolean;
  acceptsTasks?: boolean;
  team?: string | null;
}

export interface UserFilters {
  search: string;
  role: string; // legacy token or 'all'
  team: string; // team value or 'all'
  active: 'all' | 'active' | 'inactive';
  acceptsTasks: 'all' | 'yes' | 'no';
}

export type SortKey = 'name' | 'role' | 'team';
export type SortDir = 'asc' | 'desc';

export type GroupBy = 'teamLead' | 'team' | 'manager' | 'none';

export interface UserGroup {
  groupKey: string;
  label: string;
  users: ManageableUser[];
}

const NONE_LABEL = '(none)';

/** Display name derived from the user's email (e.g. "Aarav Patel"). */
export const userDisplayName = (user: ManageableUser): string =>
  deriveDisplayNameFromEmail(user.email);

const sortKeyValue = (user: ManageableUser, key: SortKey): string => {
  switch (key) {
    case 'name':
      return userDisplayName(user).toLowerCase();
    case 'role':
      return (user.role ?? '').toLowerCase();
    case 'team':
      return (user.team ?? '').toLowerCase();
    default:
      return '';
  }
};

export function filterUsers(users: ManageableUser[], filters: UserFilters): ManageableUser[] {
  const search = (filters.search ?? '').trim().toLowerCase();

  return users.filter((user) => {
    if (search) {
      const name = userDisplayName(user).toLowerCase();
      const email = (user.email ?? '').toLowerCase();
      if (!name.includes(search) && !email.includes(search)) {
        return false;
      }
    }

    if (filters.role && filters.role !== 'all') {
      if ((user.role ?? '') !== filters.role) return false;
    }

    if (filters.team && filters.team !== 'all') {
      if ((user.team ?? '') !== filters.team) return false;
    }

    if (filters.active === 'active' && !user.active) return false;
    if (filters.active === 'inactive' && user.active) return false;

    if (filters.acceptsTasks === 'yes' && !user.acceptsTasks) return false;
    if (filters.acceptsTasks === 'no' && user.acceptsTasks) return false;

    return true;
  });
}

export function sortUsers(users: ManageableUser[], key: SortKey, dir: SortDir): ManageableUser[] {
  const factor = dir === 'desc' ? -1 : 1;
  // Decorate with original index for a stable sort across engines.
  return users
    .map((user, index) => ({ user, index }))
    .sort((a, b) => {
      const av = sortKeyValue(a.user, key);
      const bv = sortKeyValue(b.user, key);
      if (av < bv) return -1 * factor;
      if (av > bv) return 1 * factor;
      return a.index - b.index; // stable tie-break
    })
    .map((entry) => entry.user);
}

export function groupUsers(users: ManageableUser[], by: GroupBy): UserGroup[] {
  if (by === 'none') {
    return [{ groupKey: 'all', label: 'All users', users: [...users] }];
  }

  const buckets = new Map<string, ManageableUser[]>();
  users.forEach((user) => {
    const raw = (user[by] ?? '').toString().trim();
    const key = raw || NONE_LABEL;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(user);
    } else {
      buckets.set(key, [user]);
    }
  });

  return Array.from(buckets.entries())
    .map(([label, groupUsers]) => ({ groupKey: label, label, users: groupUsers }))
    .sort((a, b) => {
      // '(none)' always sorts last; everything else alphabetical.
      if (a.label === NONE_LABEL) return 1;
      if (b.label === NONE_LABEL) return -1;
      return a.label.localeCompare(b.label);
    });
}
