// EditUserDrawer — the policy-driven edit surface. Click a directory row
// and this slides in from the right. The whole point of the redesign:
// every field is rendered purely from `fieldPolicy(actor, target, field)`
// — it shows only what the actor may change, makes auto-fill rules
// visible, and never silently overwrites a locked/hidden value.
//
// Save builds a single bulk-update entry and PUTs /api/users/bulk:
//   - editable fields  → included only when changed from their initial
//   - auto fields      → policy value only when the field is currently
//                        blank; an existing value is preserved (not sent)
//   - locked / hidden  → never sent
//   - password         → included only when "Reset password" was used
//
// Theme: @/components/ui/* primitives + semantic tokens only.

import { useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { API_URL, useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { fieldPolicy, canAssign, type ActorContext, type FieldKey } from './rolePolicy';
import { roleLabel } from './roleLabels';
import { teamLeadOptionsFor, managerOptionsFor } from './options';
import type { ManageableUser } from './grouping';

const TEAMS = ['marketing', 'technical', 'sales'] as const;

// Radix <Select> disallows an empty-string item value, so clearing an
// optional roster field (teamLead / manager) routes through this sentinel
// and is mapped back to '' before it reaches the form/payload.
const NONE_VALUE = '__none__';

// Friendly copy for the auto/locked policy reasons surfaced as hints.
const REASON_HINTS: Record<string, string> = {
  'team-lead-is-self': 'Auto-set from your team lead',
  'manager-is-self': 'Auto-set from you',
  'manager-is-actor-manager': 'Auto-set from your manager',
  'role-not-assignable': 'You cannot change this role at your level',
  'mam-has-no-team-lead': 'This role has no team lead',
  'team-admin-only': 'Team is set by an admin',
  'actor-cannot-manage': 'Not editable at your level',
};

const hintFor = (reason?: string): string => (reason ? REASON_HINTS[reason] ?? '' : '');

export interface EditUserDrawerProps {
  open: boolean;
  user: ManageableUser;
  actorRole: string;
  actorContext: ActorContext;
  allUsers: ManageableUser[];
  onClose: () => void;
  onSaved: (result: { success: boolean; updates?: unknown[]; failures?: unknown[] }) => void;
}

// Local editable form state. Strings for the select/text controls,
// booleans for the switches.
interface FormState {
  role: string;
  team: string;
  teamLead: string;
  manager: string;
  active: boolean;
  acceptsTasks: boolean;
}

const buildInitial = (user: ManageableUser): FormState => ({
  role: (user.role ?? '').toLowerCase(),
  team: (user.team ?? '') as string,
  teamLead: user.teamLead ?? '',
  manager: user.manager ?? '',
  active: Boolean(user.active),
  acceptsTasks: Boolean(user.acceptsTasks),
});

// A read-only value box (used by auto + locked states), optionally with a
// lock glyph and a hint line beneath it.
function ReadOnlyField({
  label,
  value,
  hint,
  locked,
}: {
  label: string;
  value: string;
  hint?: string;
  locked?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-muted-foreground">{label}</Label>
      <div className="flex h-10 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-foreground">
        <span className="flex-1 truncate">{value || '—'}</span>
        {locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function EditUserDrawer({
  open,
  user,
  actorRole,
  actorContext,
  allUsers,
  onClose,
  onSaved,
}: EditUserDrawerProps) {
  const { authFetch } = useAuth();
  const { toast } = useToast();

  const [form, setForm] = useState<FormState>(() => buildInitial(user));
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever a different user is opened.
  useEffect(() => {
    setForm(buildInitial(user));
    setShowPasswordField(false);
    setPassword('');
  }, [user]);

  const initial = useMemo(() => buildInitial(user), [user]);

  // Resolve the policy once per (actor, target) pair.
  const policyFor = (field: FieldKey) =>
    fieldPolicy(actorRole, user.role, field, actorContext);

  const teamLeadOpts = useMemo(
    () => teamLeadOptionsFor(user.role, allUsers),
    [user.role, allUsers],
  );
  const managerOpts = useMemo(
    () => managerOptionsFor(user.role, allUsers),
    [user.role, allUsers],
  );
  const assignableRoles = useMemo(() => canAssign(actorRole), [actorRole]);

  // Build the bulk-update entry per the rules in the file header.
  const buildEntry = (): Record<string, unknown> => {
    const entry: Record<string, unknown> = { email: user.email };
    const fields: FieldKey[] = ['role', 'team', 'teamLead', 'manager', 'active', 'acceptsTasks'];

    for (const field of fields) {
      const policy = policyFor(field);
      if (policy.state === 'hidden' || policy.state === 'locked') continue;
      if (policy.state === 'auto') {
        // An auto value is a FALLBACK for when the field is blank, not an
        // override. If the target already has a value, preserve it (omit
        // from the payload so the backend keeps it). Otherwise seed the
        // policy's resolved value. Without this, e.g. a mam editing a
        // recruiter would silently reassign the recruiter's manager to the
        // mam's own manager on every save.
        // `field in initial` guards the cast — FieldKey includes 'password',
        // which is not a FormState key (and is filtered out of `fields`).
        const existing = field in initial ? initial[field as keyof FormState] : undefined;
        const hasExisting =
          existing !== undefined && existing !== null && existing !== '';
        if (!hasExisting && policy.value !== undefined) entry[field] = policy.value;
        continue;
      }
      // editable → include only when changed from the initial value.
      const current = form[field as keyof FormState];
      if (current !== initial[field as keyof FormState]) {
        entry[field] = current;
      }
    }

    if (showPasswordField && password) {
      entry.password = password;
    }
    return entry;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`${API_URL}/api/users/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: [buildEntry()] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        const failure = Array.isArray(data?.failures) ? data.failures[0] : null;
        throw new Error(failure?.error || data?.error || 'Update failed');
      }
      onSaved(data);
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Could not save changes',
        description: err?.message || 'The update request failed.',
      });
    } finally {
      setSaving(false);
    }
  };

  // --- per-field renderers, all driven by fieldPolicy ----------------

  const renderRole = () => {
    const policy = policyFor('role');
    if (policy.state === 'hidden') return null;
    if (policy.state === 'editable') {
      return (
        <div className="space-y-1">
          <Label>Role</Label>
          <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
            <SelectTrigger aria-label="Role">
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              {assignableRoles.map((r) => (
                <SelectItem key={r} value={r}>
                  {roleLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }
    // locked (auto is not produced for role)
    return (
      <ReadOnlyField
        label="Role"
        value={roleLabel(user.role)}
        locked
        hint={hintFor(policy.reason)}
      />
    );
  };

  const renderTeam = () => {
    const policy = policyFor('team');
    if (policy.state === 'hidden') return null;
    if (policy.state === 'editable') {
      return (
        <div className="space-y-1">
          <Label>Team</Label>
          <Select value={form.team} onValueChange={(v) => setForm((f) => ({ ...f, team: v }))}>
            <SelectTrigger aria-label="Team">
              <SelectValue placeholder="Select a team" />
            </SelectTrigger>
            <SelectContent>
              {TEAMS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }
    const value = typeof policy.value === 'string' ? policy.value : (user.team ?? '');
    return (
      <ReadOnlyField
        label="Team"
        value={value}
        locked={policy.state === 'locked'}
        hint={hintFor(policy.reason)}
      />
    );
  };

  // Shared renderer for the teamLead / manager fields (same four states).
  const renderRoster = (
    field: 'teamLead' | 'manager',
    label: string,
    options: string[],
  ) => {
    const policy = policyFor(field);
    if (policy.state === 'hidden') return null;
    if (policy.state === 'editable') {
      const current = form[field];
      // Keep a pre-existing free value selectable even if it is not in the
      // computed roster ("allow free value too").
      const merged = current && !options.includes(current) ? [current, ...options] : options;
      return (
        <div className="space-y-1">
          <Label>{label}</Label>
          <Select
            value={current || undefined}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, [field]: v === NONE_VALUE ? '' : v }))
            }
          >
            <SelectTrigger aria-label={label}>
              <SelectValue placeholder={`Select a ${label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {/* Radix forbids an empty-string item value, so clearing uses
                  a sentinel mapped back to '' in onValueChange. */}
              <SelectItem value={NONE_VALUE}>None</SelectItem>
              {merged.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }
    // auto | locked → read-only value from the policy.
    const value = typeof policy.value === 'string' ? policy.value : (user[field] ?? '');
    return (
      <ReadOnlyField
        label={label}
        value={value}
        locked={policy.state === 'locked'}
        hint={hintFor(policy.reason)}
      />
    );
  };

  const renderSwitch = (field: 'active' | 'acceptsTasks', label: string) => {
    const policy = policyFor(field);
    if (policy.state === 'hidden') return null;
    const editable = policy.state === 'editable';
    return (
      <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
        <Label htmlFor={`field-${field}`}>{label}</Label>
        <Switch
          id={`field-${field}`}
          aria-label={label}
          checked={form[field]}
          disabled={!editable}
          onCheckedChange={(v) => setForm((f) => ({ ...f, [field]: v }))}
        />
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{user.email}</SheetTitle>
          <SheetDescription>{roleLabel(user.role)} · read-only email</SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {renderRole()}
          {renderTeam()}
          {renderRoster('teamLead', 'Team Lead', teamLeadOpts)}
          {renderRoster('manager', 'Manager', managerOpts)}
          {renderSwitch('active', 'Active')}
          {renderSwitch('acceptsTasks', 'Accepts tasks')}

          {showPasswordField ? (
            <div className="space-y-1">
              <Label htmlFor="reset-password">New password</Label>
              <Input
                id="reset-password"
                type="password"
                aria-label="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter a temporary password"
              />
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowPasswordField(true)}
            >
              Reset password
            </Button>
          )}
        </div>

        <SheetFooter className="mt-6">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
