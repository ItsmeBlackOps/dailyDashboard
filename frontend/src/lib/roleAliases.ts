// C20 — translation shim between backend's new role names and the
// legacy role names that ~150 frontend sites still compare against.
//
// After the May 2026 migration, the database stores new names. The
// backend dual-accepts both. This shim translates incoming new names
// back to legacy on read so existing UI comparisons keep working
// untouched. The deep frontend rename will replace this shim.
//
// `assistantManager` and `teamLead` are team-aware — old `am`/`mam`
// and `lead`/`mlead` carried implicit technical/marketing splits that
// are now expressed via the separate `team` field.

export type LegacyRole =
  | 'admin'
  | 'mm'
  | 'mam'
  | 'mlead'
  | 'am'
  | 'lead'
  | 'recruiter'
  | 'user';

export type Team = 'technical' | 'marketing' | 'sales' | null;

export const toLegacyRole = (role?: string | null, team?: string | null): string => {
  const r = (role ?? '').toString().toLowerCase().trim();
  const t = (team ?? '').toString().toLowerCase().trim();
  switch (r) {
    case 'manager':
      return 'mm';
    case 'assistantmanager':
      return t === 'technical' ? 'am' : 'mam';
    case 'teamlead':
      return t === 'technical' ? 'lead' : 'mlead';
    case 'expert':
      return 'user';
    // legacy + unchanged names pass through
    default:
      return r;
  }
};

// Inverse — when sending role to backend (e.g. on update), prefer the
// new name. Backend dual-accepts so this is safe.
export const toCanonicalRole = (legacyRole?: string | null, team?: string | null): string => {
  const r = (legacyRole ?? '').toString().toLowerCase().trim();
  const t = (team ?? '').toString().toLowerCase().trim();
  switch (r) {
    case 'mm':
      return 'manager';
    case 'mam':
    case 'am':
      return 'assistantManager';
    case 'mlead':
    case 'lead':
      return 'teamLead';
    case 'user':
      return 'expert';
    default:
      return r;
  }
};

// Convenience for normalising a user object in API responses.
export interface UserShape {
  role?: string | null;
  team?: string | null;
  [key: string]: unknown;
}

export const normalizeUserRoleForLegacy = <U extends UserShape>(user: U): U => {
  if (!user || typeof user !== 'object') return user;
  return {
    ...user,
    role: toLegacyRole(user.role as string, user.team as string),
  };
};
