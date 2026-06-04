// rolePolicy — the single source of truth for who can create/assign
// which roles, and what state each editable field is in for a given
// (actor, targetRole) pair.
//
// This is a verbatim re-encoding of the rules that today live inline in
// frontend/src/pages/UserManagement.tsx (getCreatableRoles,
// assignableRoles, enforceRoleDefaults, computeTeamLeadValue,
// computeManagerValue, and the per-row field-visibility flags). Pulling
// them into one tested module is the whole point of the redesign — the
// page becomes a renderer over this policy.
//
// All inputs are normalized to lowercase legacy tokens. Actors that do
// not manage anyone (recruiter, user — and any unknown token) get a
// fully locked result; the page is hidden from them anyway, this is a
// belt-and-braces default.

import type { LegacyRole } from '@/lib/roleAliases';

export type { LegacyRole };

export type FieldKey =
  | 'role'
  | 'team'
  | 'teamLead'
  | 'manager'
  | 'active'
  | 'acceptsTasks'
  | 'password';

export type FieldState = 'editable' | 'auto' | 'locked' | 'hidden';

export interface ActorContext {
  /** Display name of the acting user (e.g. derived from their email). */
  selfDisplayName: string;
  /** Display name of the acting user's own manager. */
  actorManager: string;
}

export interface PolicyResult {
  state: FieldState;
  value?: string | boolean;
  reason?: string;
}

const ALL_ROLES: LegacyRole[] = [
  'admin',
  'mm',
  'mam',
  'am',
  'mlead',
  'lead',
  'recruiter',
  'user',
];

// Who each actor may CREATE. Mirrors getCreatableRoles in the page.
const CREATE_MAP: Record<string, LegacyRole[]> = {
  admin: [...ALL_ROLES],
  mm: ['mam', 'mlead', 'recruiter'],
  mam: ['mlead', 'recruiter'],
  am: ['lead', 'user'],
  lead: ['user'],
  mlead: ['recruiter'],
  recruiter: [],
  user: [],
};

// Which role an actor may ASSIGN on update. Mirrors `assignableRoles`
// in the page (minus the '__no_change__' sentinel). An empty array
// means the role field is locked. mlead differs from its CREATE set:
// it can create recruiters but cannot reassign an existing user's role.
const ASSIGN_MAP: Record<string, LegacyRole[]> = {
  admin: [...ALL_ROLES],
  mm: ['mam', 'mlead', 'recruiter'],
  mam: ['mlead', 'recruiter'],
  am: ['lead', 'user'],
  lead: ['user'],
  mlead: [],
  recruiter: [],
  user: [],
};

const norm = (value: string | null | undefined): string =>
  (value ?? '').toString().toLowerCase().trim();

const MANAGING_ACTORS = new Set(['admin', 'mm', 'mam', 'am', 'mlead', 'lead']);

export function canCreate(actor: string): LegacyRole[] {
  return [...(CREATE_MAP[norm(actor)] ?? [])];
}

export function canAssign(actor: string): LegacyRole[] {
  return [...(ASSIGN_MAP[norm(actor)] ?? [])];
}

function roleFieldPolicy(actor: string): PolicyResult {
  // The role field is locked exactly when the actor can assign no role,
  // and editable otherwise (the page constrains options to canAssign).
  //
  // NOTE: the source matrix's standalone "mm: role locked" cell is
  // inconsistent with both its own canAssign(mm)=[mam,mlead,recruiter]
  // row and the current page (which renders the role <Select> for mm on
  // update). We follow canAssign + the page: mm role is editable. Only
  // mlead/recruiter/user end up locked here.
  if (canAssign(actor).length === 0) {
    return { state: 'locked', reason: 'role-not-assignable' };
  }
  return { state: 'editable' };
}

function teamLeadPolicy(actor: string, target: string, ctx: ActorContext): PolicyResult {
  const self = ctx.selfDisplayName;
  switch (actor) {
    case 'admin':
      return { state: 'editable' };
    case 'mm':
      // Hidden for mam targets (a mam has no team lead), editable
      // otherwise (preserve-if-blank handled at the form layer).
      return target === 'mam'
        ? { state: 'hidden', reason: 'mam-has-no-team-lead' }
        : { state: 'editable' };
    case 'mam':
      return target === 'mlead'
        ? { state: 'auto', value: self, reason: 'team-lead-is-self' }
        : { state: 'editable' };
    case 'am':
      // lead reports to this am → auto self; user is free-form.
      return target === 'lead'
        ? { state: 'auto', value: self, reason: 'team-lead-is-self' }
        : { state: 'editable' };
    case 'mlead':
    case 'lead':
      return { state: 'locked', value: self, reason: 'team-lead-is-self' };
    default:
      return { state: 'locked' };
  }
}

function managerPolicy(actor: string, target: string, ctx: ActorContext): PolicyResult {
  const self = ctx.selfDisplayName;
  const actorMgr = ctx.actorManager;
  switch (actor) {
    case 'admin':
      return { state: 'editable' };
    case 'mm':
      // The mm IS the manager of everyone they provision; forced to
      // self, falling back to the mm's own manager if self is blank.
      return { state: 'auto', value: self || actorMgr, reason: 'manager-is-self' };
    case 'mam':
      return target === 'mlead'
        ? { state: 'auto', value: actorMgr, reason: 'manager-is-actor-manager' }
        : { state: 'editable' };
    case 'am':
      // Both lead and user roll up to the am's own manager.
      return { state: 'auto', value: actorMgr, reason: 'manager-is-actor-manager' };
    case 'mlead':
    case 'lead':
      return { state: 'locked', value: actorMgr, reason: 'manager-is-actor-manager' };
    default:
      return { state: 'locked' };
  }
}

export function fieldPolicy(
  actor: string,
  targetRole: string,
  field: FieldKey,
  ctx: ActorContext,
): PolicyResult {
  const a = norm(actor);
  const target = norm(targetRole);

  // Non-managing actors (recruiter, user, anything unknown): all locked.
  if (!MANAGING_ACTORS.has(a)) {
    return { state: 'locked', reason: 'actor-cannot-manage' };
  }

  switch (field) {
    case 'role':
      return roleFieldPolicy(a);
    case 'team':
      // Only admins (team-less) may set a user's team; everyone else
      // inherits/hidden.
      return a === 'admin'
        ? { state: 'editable' }
        : { state: 'hidden', reason: 'team-admin-only' };
    case 'teamLead':
      return teamLeadPolicy(a, target, ctx);
    case 'manager':
      return managerPolicy(a, target, ctx);
    case 'active':
    case 'acceptsTasks':
    case 'password':
      // Editable for any managing actor.
      return { state: 'editable' };
    default:
      return { state: 'locked' };
  }
}
