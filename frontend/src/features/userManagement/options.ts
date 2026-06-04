// Pure helpers that compute the teamLead / manager dropdown options for
// a given target role from the loaded roster. This mirrors the current
// page's getTeamLeadOptions / getManagerOptions: a target's team lead
// must sit above it on the same side of the org, and every user's
// manager is one of the Marketing Managers (mm).
//
// Display names are derived from each user's email
// (deriveDisplayNameFromEmail), matching how the directory builds its
// rosters elsewhere (grouping.userDisplayName). No React, no I/O — fully
// unit-testable.

import { deriveDisplayNameFromEmail } from '@/utils/userNames';
import type { LegacyRole } from './roleLabels';
import type { ManageableUser } from './grouping';

const norm = (value: string | null | undefined): string =>
  (value ?? '').toString().toLowerCase().trim();

// Which roles may serve as the *team lead* for a given target role.
// Marketing side (mm → mam → mlead → recruiter) and technical side
// (mm → am → lead → user) each roll up to the mm at the top.
const TEAM_LEAD_SOURCES: Record<string, LegacyRole[]> = {
  // technical side
  user: ['lead', 'am', 'mm'],
  lead: ['am', 'mm'],
  am: ['mm'],
  // marketing side
  recruiter: ['mlead', 'mam', 'mm'],
  mlead: ['mam', 'mm'],
  mam: ['mm'],
  // mm / admin / unknown → no team lead above them
};

/** Group the roster by legacy role → derived display names. */
function namesByRole(users: ManageableUser[], roles: LegacyRole[]): string[] {
  const wanted = new Set(roles.map((r) => r as string));
  const names = users
    .filter((u) => wanted.has(norm(u.role)))
    .map((u) => deriveDisplayNameFromEmail(u.email))
    .filter(Boolean);
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

/**
 * Display names eligible to be the team lead of `targetRole`, drawn from
 * the loaded users. De-duped and alphabetically sorted. Returns [] for
 * roles that have no team lead above them (mm, admin, unknown).
 */
export function teamLeadOptionsFor(targetRole: string, users: ManageableUser[]): string[] {
  const sources = TEAM_LEAD_SOURCES[norm(targetRole)];
  if (!sources || sources.length === 0) return [];
  return namesByRole(users, sources);
}

/**
 * Display names eligible to be the manager of `targetRole`. Every user's
 * manager is one of the Marketing Managers (mm), so this is the mm roster
 * regardless of target. De-duped and alphabetically sorted.
 */
export function managerOptionsFor(_targetRole: string, users: ManageableUser[]): string[] {
  return namesByRole(users, ['mm']);
}
