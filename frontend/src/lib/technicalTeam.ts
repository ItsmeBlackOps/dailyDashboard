// Roles that make up the technical team — the experts who join interviews and
// the technical leads/AMs over them. Stored roles on the frontend are the
// legacy form (e.g. RoleDetailRequiredDialog gates on role === 'user'), where
// the string itself encodes the team: user/expert = expert, lead = technical
// teamLead, am = technical assistantManager. Marketing-side roles
// (mm/mam/mlead/recruiter) and admin are intentionally excluded.
//
// Adjust this one set to change who the Meeting Detector gate applies to.
export const TECHNICAL_TEAM_ROLES = new Set(['user', 'expert', 'lead', 'am']);

export function isTechnicalTeam(role?: string | null): boolean {
  return TECHNICAL_TEAM_ROLES.has((role || '').trim().toLowerCase());
}
