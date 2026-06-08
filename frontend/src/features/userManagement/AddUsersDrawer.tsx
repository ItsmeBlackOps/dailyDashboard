// AddUsersDrawer — the "+ Add users" surface, powered by the same
// role-policy engine as the edit drawer. A Form tab holds one-or-more
// new-user rows ("+ Add another"); a Bulk paste tab turns a pasted list
// of emails into rows for review. Both hit the existing bulk endpoint:
//   POST /api/users/bulk { users: [{ email, password, role, teamLead?, manager?, active }] }
//
// Per-row teamLead / manager render straight from
// fieldPolicy(actor, row.role, …): editable → a Select from the computed
// roster; auto / locked → a read-only value. The actor's create-set
// (canCreate) bounds the role options, and an mlead actor's role is
// forced to recruiter (their only creatable role).
//
// Theme: @/components/ui/* primitives + semantic tokens only.

import { useMemo, useState } from 'react';
import { Lock, Trash2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { API_URL, useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { fieldPolicy, canCreate, type ActorContext } from './rolePolicy';
import { roleLabel } from './roleLabels';
import { teamLeadOptionsFor, managerOptionsFor } from './options';
import type { ManageableUser } from './grouping';

interface NewUserRow {
  email: string;
  password: string;
  role: string;
  teamLead: string;
  manager: string;
  active: boolean;
}

const REASON_HINTS: Record<string, string> = {
  'team-lead-is-self': 'Auto-set from your team lead',
  'manager-is-self': 'Auto-set from you',
  'manager-is-actor-manager': 'Auto-set from your manager',
  'mam-has-no-team-lead': 'This role has no team lead',
  'team-admin-only': 'Team is set by an admin',
};
const hintFor = (reason?: string): string => (reason ? REASON_HINTS[reason] ?? '' : '');

// Radix <Select> disallows an empty-string item value; clearing an
// optional roster field routes through this sentinel, mapped back to ''.
const NONE_VALUE = '__none__';

// Module-level so it is compiled once, not per submit.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AddUsersDrawerProps {
  open: boolean;
  actorRole: string;
  actorContext: ActorContext;
  allUsers: ManageableUser[];
  onClose: () => void;
  /** Called after a create attempt. `hasFailures` is true on a partial
   *  success so the page can refetch but keep the drawer open. */
  onCreated: (hasFailures: boolean) => void;
}

// The role an actor creates by default + whether it is fixed (mlead).
const defaultRoleFor = (actorRole: string): string => canCreate(actorRole)[0] ?? '';
const roleIsFixed = (actorRole: string): boolean =>
  actorRole.toLowerCase().trim() === 'mlead';

const blankRow = (actorRole: string): NewUserRow => ({
  email: '',
  password: '',
  role: defaultRoleFor(actorRole),
  teamLead: '',
  manager: '',
  active: true,
});

export function AddUsersDrawer({
  open,
  actorRole,
  actorContext,
  allUsers,
  onClose,
  onCreated,
}: AddUsersDrawerProps) {
  const { authFetch } = useAuth();
  const { toast } = useToast();

  const [rows, setRows] = useState<NewUserRow[]>(() => [blankRow(actorRole)]);
  const [bulkText, setBulkText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const creatableRoles = useMemo(() => canCreate(actorRole), [actorRole]);
  const fixedRole = roleIsFixed(actorRole);

  const patchRow = (index: number, patch: Partial<NewUserRow>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const addRow = () => setRows((prev) => [...prev, blankRow(actorRole)]);
  const removeRow = (index: number) =>
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  // Parse the bulk textarea (newline / comma separated) into review rows.
  const parseBulk = () => {
    const emails = bulkText
      .split(/[\n,]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (emails.length === 0) return;
    setRows(emails.map((email) => ({ ...blankRow(actorRole), email })));
  };

  // Resolve the final payload for a row: force the mlead role, then apply
  // any auto / locked policy values for teamLead + manager so the POST
  // always reflects the policy regardless of the row's local control.
  const toPayload = (row: NewUserRow) => {
    const role = fixedRole ? 'recruiter' : row.role;

    const tlPolicy = fieldPolicy(actorRole, role, 'teamLead', actorContext);
    const mgrPolicy = fieldPolicy(actorRole, role, 'manager', actorContext);

    const resolveField = (
      policyState: string,
      policyValue: string | boolean | undefined,
      rowValue: string,
    ): string | undefined => {
      if (policyState === 'hidden') return undefined;
      if (policyState === 'auto' || policyState === 'locked') {
        return typeof policyValue === 'string' ? policyValue : undefined;
      }
      return rowValue || undefined; // editable
    };

    const payload: Record<string, unknown> = {
      email: row.email,
      password: row.password,
      role,
      active: row.active,
    };
    const teamLead = resolveField(tlPolicy.state, tlPolicy.value, row.teamLead);
    const manager = resolveField(mgrPolicy.state, mgrPolicy.value, row.manager);
    if (teamLead !== undefined) payload.teamLead = teamLead;
    if (manager !== undefined) payload.manager = manager;
    return payload;
  };

  const handleSubmit = async () => {
    // Client-side validation — catch obvious problems before the round-trip
    // so the user gets instant feedback (mirrors the legacy page).
    const problems: string[] = [];
    rows.forEach((r, i) => {
      if (!EMAIL_RE.test((r.email || '').trim())) problems.push(`Row ${i + 1}: enter a valid email`);
      if ((r.password || '').length < 8) problems.push(`Row ${i + 1}: password needs 8+ characters`);
    });
    if (problems.length) {
      toast({
        variant: 'destructive',
        title: 'Fix these before creating',
        description: problems.slice(0, 4).join(' · '),
      });
      return;
    }

    setSubmitting(true);
    try {
      const users = rows.map(toPayload);
      const res = await authFetch(`${API_URL}/api/users/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users }),
      });
      const data = await res.json().catch(() => ({}));
      const created = Array.isArray(data.created) ? data.created : [];
      const failed = Array.isArray(data.failures) ? data.failures : [];

      // Hard failure only when the request was rejected or NOTHING was
      // created. A partial success (backend returns success:false but with
      // some `created`) must still refresh the directory and report which
      // rows failed — otherwise the created users are invisible and a retry
      // re-creates them.
      if (!res.ok || (!data?.success && created.length === 0)) {
        throw new Error((failed[0] && failed[0].error) || data?.error || 'Create failed');
      }

      const createdCount = created.length || users.length - failed.length;
      toast({
        variant: failed.length ? 'destructive' : undefined,
        title: `Created ${createdCount} user${createdCount === 1 ? '' : 's'}`,
        description: failed.length
          ? `${failed.length} failed: ${failed.map((f: any) => f.email).filter(Boolean).join(', ')}`
          : undefined,
      });
      if (failed.length > 0) {
        // Keep only the failed rows so the user can correct + retry without
        // re-typing the ones that already succeeded. The page refetches but
        // leaves the drawer open (keyed off the hasFailures flag).
        const failedEmails = new Set(failed.map((f: any) => f.email).filter(Boolean));
        setRows((prev) => prev.filter((r) => failedEmails.has(r.email)));
        onCreated(true);
      } else {
        onCreated(false);
      }
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Could not create users',
        description: err?.message || 'The create request failed.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // --- a single new-user row, used by both tabs ----------------------
  const renderRow = (row: NewUserRow, index: number) => {
    const num = index + 1;
    const role = fixedRole ? 'recruiter' : row.role;
    const tlPolicy = fieldPolicy(actorRole, role, 'teamLead', actorContext);
    const mgrPolicy = fieldPolicy(actorRole, role, 'manager', actorContext);
    const teamLeadOpts = teamLeadOptionsFor(role, allUsers);
    const managerOpts = managerOptionsFor(role, allUsers);

    const renderRoster = (
      field: 'teamLead' | 'manager',
      label: string,
      policy: { state: string; value?: string | boolean; reason?: string },
      options: string[],
    ) => {
      if (policy.state === 'hidden') return null;
      if (policy.state === 'editable') {
        const current = row[field];
        const merged = current && !options.includes(current) ? [current, ...options] : options;
        return (
          <div className="space-y-1">
            <Label>{label}</Label>
            <Select
              value={current || undefined}
              onValueChange={(v) => patchRow(index, { [field]: v === NONE_VALUE ? '' : v })}
            >
              <SelectTrigger aria-label={`${label} ${num}`}>
                <SelectValue placeholder={`Select a ${label.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
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
      const value = typeof policy.value === 'string' ? policy.value : '';
      return (
        <div className="space-y-1">
          <Label className="text-muted-foreground">{label}</Label>
          <div className="flex h-10 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-foreground">
            <span className="flex-1 truncate">{value || '—'}</span>
            {policy.state === 'locked' && (
              <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          {hintFor(policy.reason) && (
            <p className="text-xs text-muted-foreground">{hintFor(policy.reason)}</p>
          )}
        </div>
      );
    };

    return (
      <div key={index} className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">User {num}</span>
          {rows.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove user ${num}`}
              onClick={() => removeRow(index)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Email</Label>
            <Input
              aria-label={`Email ${num}`}
              type="email"
              placeholder="new.person@…"
              value={row.email}
              onChange={(e) => patchRow(index, { email: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>Temp password</Label>
            <Input
              aria-label={`Password ${num}`}
              type="password"
              placeholder="••••••••"
              value={row.password}
              onChange={(e) => patchRow(index, { password: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label>Role</Label>
            {fixedRole ? (
              <div className="flex h-10 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm text-foreground">
                <span className="flex-1 truncate">{roleLabel('recruiter')}</span>
                <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </div>
            ) : (
              <Select value={row.role} onValueChange={(v) => patchRow(index, { role: v })}>
                <SelectTrigger aria-label={`Role ${num}`}>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {creatableRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {roleLabel(r)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {renderRoster('teamLead', 'Team Lead', tlPolicy, teamLeadOpts)}
          {renderRoster('manager', 'Manager', mgrPolicy, managerOpts)}

          <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2 sm:col-span-2">
            <Label htmlFor={`active-${num}`}>Active</Label>
            <Switch
              id={`active-${num}`}
              aria-label={`Active ${num}`}
              checked={row.active}
              onCheckedChange={(v) => patchRow(index, { active: v })}
            />
          </div>
        </div>
      </div>
    );
  };

  const createLabel = `Create ${rows.length} user${rows.length === 1 ? '' : 's'}`;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Add users</SheetTitle>
          <SheetDescription>
            New accounts use your role policy for team lead and manager.
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="form" className="mt-4">
          <TabsList>
            <TabsTrigger value="form">Form</TabsTrigger>
            <TabsTrigger value="bulk">Bulk paste</TabsTrigger>
          </TabsList>

          <TabsContent value="form" className="space-y-3">
            {rows.map((row, i) => renderRow(row, i))}
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              + Add another
            </Button>
          </TabsContent>

          <TabsContent value="bulk" className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="bulk-emails">Emails to add</Label>
              <Textarea
                id="bulk-emails"
                aria-label="Emails to add"
                placeholder={'one per line or comma-separated\nnew.one@…\nnew.two@…'}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={parseBulk}>
              Parse
            </Button>
            {rows.map((row, i) => renderRow(row, i))}
          </TabsContent>
        </Tabs>

        <SheetFooter className="mt-6">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creating…' : createLabel}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
