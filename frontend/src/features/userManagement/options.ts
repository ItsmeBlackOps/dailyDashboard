// Pure helpers that compute the teamLead / manager dropdown options for
// a given target role from the loaded roster. A target's team lead must
// sit above it on the same side of the org (marketing: mm → mam → mlead
// → recruiter; technical: mm → am → lead → user).
//
// Department scoping: the lead/AM legacy tokens encode their side
// already (lead vs mlead, am vs mam). The manager tier (mm) is one token
// for both sides, so mm candidates are matched against the target's side
// via their `team` field — an mm with no team set counts for both sides
// (dual-read-safe). Inactive users are never offered: assigning a
// deactivated person as someone's lead/manager strands the report.
//
// Real-org note (verified in prod): the technical side has NO manager-
// tier users — every expert's manager is a team-less admin ("Harsh
// Patel"). managerOptionsFor therefore falls back to the admin roster
// when no mm matches the target's side, so the dropdown never goes
// empty-but-required.
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

// Which side of the org a legacy role token sits on. mm/admin are
// side-less (they top both chains).
const ROLE_SIDE: Record<string, 'technical' | 'marketing'> = {
  user: 'technical',
  lead: 'technical',
  am: 'technical',
  recruiter: 'marketing',
  mlead: 'marketing',
  mam: 'marketing',
};

/** Side of the org for a target: explicit team first, else from the role. */
export function sideOf(
  role: string,
  team?: string | null,
): 'technical' | 'marketing' | null {
  const t = norm(team);
  if (t === 'technical' || t === 'marketing') return t;
  return ROLE_SIDE[norm(role)] ?? null;
}

const isActive = (u: ManageableUser): boolean => u.active !== false;

/** Side-less tiers (mm, admin) match a side when their team is unset or equal. */
const matchesSide = (u: ManageableUser, side: 'technical' | 'marketing' | null): boolean => {
  if (!side) return true;
  const t = norm(u.team);
  return !t || t === side;
};

function toNames(users: ManageableUser[]): string[] {
  const names = users.map((u) => deriveDisplayNameFromEmail(u.email)).filter(Boolean);
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

/**
 * Display names eligible to be the team lead of `targetRole`, drawn from
 * the loaded users — same department only (lead/AM tokens are side-coded;
 * the mm tier is filtered by `team`, unset matching both). Excludes
 * inactive users. De-duped and alphabetically sorted. Returns [] for
 * roles with no team lead above them (mm, admin, unknown).
 */
export function teamLeadOptionsFor(
  targetRole: string,
  users: ManageableUser[],
  targetTeam?: string | null,
): string[] {
  const sources = TEAM_LEAD_SOURCES[norm(targetRole)];
  if (!sources || sources.length === 0) return [];
  const side = sideOf(targetRole, targetTeam);
  const wanted = new Set(sources.map((r) => r as string));
  return toNames(
    users.filter(
      (u) =>
        isActive(u) &&
        wanted.has(norm(u.role)) &&
        (norm(u.role) !== 'mm' || matchesSide(u, side)),
    ),
  );
}

/**
 * Display names eligible to be the manager of `targetRole`: the manager
 * (mm) roster of the target's side — an mm with no team counts for both
 * sides. When no mm matches (the technical side in the real org), falls
 * back to team-less admins so the dropdown stays usable. Excludes
 * inactive users. De-duped and alphabetically sorted.
 */
export function managerOptionsFor(
  targetRole: string,
  users: ManageableUser[],
  targetTeam?: string | null,
): string[] {
  const side = sideOf(targetRole, targetTeam);
  const mms = users.filter(
    (u) => isActive(u) && norm(u.role) === 'mm' && matchesSide(u, side),
  );
  if (mms.length > 0) return toNames(mms);
  return toNames(
    users.filter((u) => isActive(u) && norm(u.role) === 'admin' && matchesSide(u, side)),
  );
}

/**
 * Names valid for EVERY list — the bulk bar applies one value across the
 * whole selection, so an option must be eligible for each selected user.
 * [] in → [] out.
 */
export function intersectOptions(lists: string[][]): string[] {
  if (lists.length === 0) return [];
  return lists.reduce((acc, list) => acc.filter((name) => list.includes(name)));
}
