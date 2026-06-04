// UserManagementPage — the composed User Management redesign. This is a
// thin renderer over the feature's tested pieces: the data hook
// (useManageableUsers), the pure filter/sort/group helpers (grouping.ts),
// the role policy (rolePolicy.ts), and the presentational components
// (DirectoryToolbar, BulkActionBar, UserTable, EditUserDrawer,
// AddUsersDrawer). The page owns the toolbar/selection/drawer state and
// performs the writes; every rule lives in the imported modules.
//
// Writes go through the existing bulk endpoint:
//   PUT /api/users/bulk { users: [{ email, ...fields }] }
// then refetch(). (Simplest correct path — no optimistic UI.)
//
// acceptsTasks note: the bulk-update endpoint (backend
// userService.bulkUpdateUsers) does NOT copy `acceptsTasks` into its
// update payload — only role/teamLead/manager/active/team/password are
// honored. So the inline "Accepts" toggle has no writable backend path
// and is rendered disabled (canToggleAccepts is always false). Flagged
// for a follow-up; we do not invent an endpoint here.
//
// Theme: @/components/ui/* primitives + semantic tokens only.

import { useCallback, useMemo, useState } from 'react';
import { AlertCircle, Users } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { API_URL, useAuth } from '@/hooks/useAuth';

import { useManageableUsers } from './useManageableUsers';
import { canCreate, fieldPolicy } from './rolePolicy';
import {
  filterUsers,
  sortUsers,
  groupUsers,
  type ManageableUser,
  type GroupBy,
  type SortKey,
  type SortDir,
} from './grouping';
import { DirectoryToolbar, type DirectoryFilters } from './DirectoryToolbar';
import { BulkActionBar, type BulkPatch } from './BulkActionBar';
import { UserTable } from './UserTable';
import { EditUserDrawer } from './EditUserDrawer';
import { AddUsersDrawer } from './AddUsersDrawer';

// Actors who may reach the management surface. Belt-and-braces — the
// route is auth-gated already and the sidebar hides the link, but the
// route itself is not role-scoped, so we gate here too.
const MANAGING_ROLES = ['admin', 'mm', 'mam', 'mlead', 'lead', 'am'];

const DEFAULT_FILTERS: DirectoryFilters = {
  role: 'all',
  team: 'all',
  active: 'all',
  acceptsTasks: 'all',
};

// Distinct legacy role tokens among a set of users (for the bulk bar's
// "can change role" gate).
const distinctRoles = (users: ManageableUser[]): string[] =>
  Array.from(new Set(users.map((u) => (u.role ?? '').toLowerCase()).filter(Boolean)));

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">User Management</h1>
          <p className="text-sm text-muted-foreground">
            Manage your team — roles, reporting lines, and access.
          </p>
        </div>
        {children}
      </div>
    </DashboardLayout>
  );
}

export function UserManagementPage() {
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const { users, loading, error, refetch, actorContext, actorRole } = useManageableUsers();

  const canManage = MANAGING_ROLES.includes((actorRole ?? '').toLowerCase());

  // --- toolbar / selection / drawer state ----------------------------
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<DirectoryFilters>(DEFAULT_FILTERS);
  const [groupBy, setGroupBy] = useState<GroupBy>('teamLead');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [editUser, setEditUser] = useState<ManageableUser | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // --- derived view ---------------------------------------------------
  // filterUsers expects `search` inside the filter object; the toolbar's
  // DirectoryFilters does not carry it, so merge it in here.
  const visible = useMemo(
    () => sortUsers(filterUsers(users, { ...filters, search }), sort.key, sort.dir),
    [users, filters, search, sort.key, sort.dir],
  );
  const groups = useMemo(() => groupUsers(visible, groupBy), [visible, groupBy]);

  const selectedUsers = useMemo(
    () => users.filter((u) => selectedEmails.has(u.email)),
    [users, selectedEmails],
  );
  const selectedRoles = useMemo(() => distinctRoles(selectedUsers), [selectedUsers]);

  // --- per-row policy predicates -------------------------------------
  const canToggleActive = useCallback(
    (u: ManageableUser) =>
      fieldPolicy(actorRole, u.role, 'active', actorContext).state === 'editable',
    [actorRole, actorContext],
  );
  // acceptsTasks is not writable via the bulk endpoint (see file header),
  // so the inline toggle is always disabled regardless of policy.
  const canToggleAccepts = useCallback((_u: ManageableUser) => false, []);

  // --- writes ---------------------------------------------------------
  // PUT a batch of partial user updates, then refetch. A destructive
  // toast surfaces any failure; success is silent for inline toggles and
  // announced for bulk applies.
  const putUpdates = useCallback(
    async (entries: Array<Record<string, unknown>>, successMsg?: string): Promise<boolean> => {
      try {
        const res = await authFetch(`${API_URL}/api/users/bulk`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ users: entries }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          const failure = Array.isArray(data?.failures) ? data.failures[0] : null;
          throw new Error(failure?.error || data?.error || 'Update failed');
        }
        await refetch();
        if (successMsg) toast({ title: successMsg });
        return true;
      } catch (err: any) {
        toast({
          variant: 'destructive',
          title: 'Could not apply changes',
          description: err?.message || 'The update request failed.',
        });
        return false;
      }
    },
    [authFetch, refetch, toast],
  );

  const handleToggleActive = useCallback(
    (u: ManageableUser, value: boolean) => {
      void putUpdates([{ email: u.email, active: value }]);
    },
    [putUpdates],
  );

  // Wired for completeness, but UserTable receives canToggleAccepts=false
  // so this never fires from the UI. If acceptsTasks becomes bulk-writable
  // later, flip canToggleAccepts and this already does the right thing.
  const handleToggleAccepts = useCallback(
    (u: ManageableUser, value: boolean) => {
      void putUpdates([{ email: u.email, acceptsTasks: value }]);
    },
    [putUpdates],
  );

  const handleSelect = useCallback((u: ManageableUser, selected: boolean) => {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (selected) next.add(u.email);
      else next.delete(u.email);
      return next;
    });
  }, []);

  const handleBulkApply = useCallback(
    async (patch: BulkPatch) => {
      const emails = [...selectedEmails];
      if (emails.length === 0) return;
      const entries = emails.map((email) => ({ email, ...patch }));
      const ok = await putUpdates(entries, `Updated ${emails.length} user${emails.length === 1 ? '' : 's'}`);
      if (ok) setSelectedEmails(new Set());
    },
    [selectedEmails, putUpdates],
  );

  // --- render ---------------------------------------------------------

  if (!canManage) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card py-16 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">Not authorized</p>
          <p className="text-sm text-muted-foreground">
            You do not have permission to manage users.
          </p>
        </div>
      </PageShell>
    );
  }

  if (loading) {
    return (
      <PageShell>
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 py-16 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">Could not load users</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <DirectoryToolbar
        search={search}
        onSearch={setSearch}
        filters={filters}
        onFilter={setFilters}
        groupBy={groupBy}
        onGroupBy={setGroupBy}
        sort={sort.key}
        onSort={(key) => setSort((prev) => ({ ...prev, key }))}
        canCreate={canCreate(actorRole).length > 0}
        onAddUsers={() => setAddOpen(true)}
      />

      <BulkActionBar
        count={selectedEmails.size}
        selectedRoles={selectedRoles}
        actorRole={actorRole}
        onApply={(patch) => void handleBulkApply(patch)}
      />

      {users.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border bg-card py-16 text-center">
          <Users className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">No users yet</p>
          <p className="text-sm text-muted-foreground">
            Users you can manage will appear here.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <UserTable
            groups={groups}
            selectedEmails={selectedEmails}
            canToggleActive={canToggleActive}
            canToggleAccepts={canToggleAccepts}
            onSelect={handleSelect}
            onOpen={setEditUser}
            onToggleActive={handleToggleActive}
            onToggleAccepts={handleToggleAccepts}
          />
        </div>
      )}

      {editUser && (
        <EditUserDrawer
          open={!!editUser}
          user={editUser}
          actorRole={actorRole}
          actorContext={actorContext}
          allUsers={users}
          onClose={() => setEditUser(null)}
          onSaved={() => {
            toast({ title: 'Changes saved' });
            void refetch();
            setEditUser(null);
          }}
        />
      )}

      <AddUsersDrawer
        open={addOpen}
        actorRole={actorRole}
        actorContext={actorContext}
        allUsers={users}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          void refetch();
          setAddOpen(false);
        }}
      />
    </PageShell>
  );
}

export default UserManagementPage;
