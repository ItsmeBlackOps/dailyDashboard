// Human-readable labels + Badge variants for the eight legacy role
// tokens the User Management UI still works in. The backend stores new
// role names post-C20; callers translate to legacy via `toLegacyRole`
// (see @/lib/roleAliases) before reaching this map.
//
// Variants are restricted to the three existing Badge variants
// (default | secondary | outline) — no new colours are introduced.

import type { LegacyRole } from '@/lib/roleAliases';

export type { LegacyRole };

export const LEGACY_ROLES: LegacyRole[] = [
  'admin',
  'mm',
  'mam',
  'am',
  'mlead',
  'lead',
  'recruiter',
  'user',
];

const ROLE_LABELS: Record<LegacyRole, string> = {
  admin: 'Admin',
  mm: 'Marketing Manager',
  mam: 'Asst. Manager (Marketing)',
  am: 'Asst. Manager (Technical)',
  mlead: 'Team Lead (Marketing)',
  lead: 'Team Lead (Technical)',
  recruiter: 'Recruiter',
  user: 'Expert',
};

export type BadgeVariant = 'default' | 'secondary' | 'outline';

const ROLE_BADGE_VARIANTS: Record<LegacyRole, BadgeVariant> = {
  admin: 'default',
  mm: 'default',
  mam: 'outline',
  am: 'outline',
  mlead: 'secondary',
  lead: 'secondary',
  recruiter: 'secondary',
  user: 'secondary',
};

/** Display label for a legacy role token; falls back to the raw token. */
export function roleLabel(role: string): string {
  const normalized = (role || '').toLowerCase().trim() as LegacyRole;
  return ROLE_LABELS[normalized] ?? role;
}

/** Badge variant for a legacy role token; falls back to 'secondary'. */
export function roleBadgeVariant(role: string): BadgeVariant {
  const normalized = (role || '').toLowerCase().trim() as LegacyRole;
  return ROLE_BADGE_VARIANTS[normalized] ?? 'secondary';
}
