// The directory toolbar: search + the four filter selects + group-by +
// sort, with a primary "Add users" button for actors who may create.
//
// Stateless / fully controlled — every change is reported up via the
// on* callbacks; the page owns the state. Styling is a responsive
// flex-wrap row built only from existing primitives + semantic tokens.

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LEGACY_ROLES, roleLabel, type LegacyRole } from './roleLabels';
import type { GroupBy, SortKey } from './grouping';

export interface DirectoryFilters {
  role: 'all' | LegacyRole;
  team: 'all' | string;
  active: 'all' | 'active' | 'inactive';
  acceptsTasks: 'all' | 'yes' | 'no';
}

export interface DirectoryToolbarProps {
  search: string;
  onSearch: (value: string) => void;
  filters: DirectoryFilters;
  onFilter: (filters: DirectoryFilters) => void;
  groupBy: GroupBy;
  onGroupBy: (groupBy: GroupBy) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  canCreate: boolean;
  onAddUsers: () => void;
}

const TEAM_OPTIONS = ['marketing', 'technical', 'sales'];

const GROUP_BY_LABELS: Record<GroupBy, string> = {
  teamLead: 'Team Lead',
  team: 'Team',
  manager: 'Manager',
  none: 'None',
};

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  role: 'Role',
  team: 'Team',
};

// A label + select pair sharing the toolbar's compact look.
function FilterField({
  label,
  ariaLabel,
  value,
  onValueChange,
  triggerClassName,
  children,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onValueChange: (value: string) => void;
  triggerClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger aria-label={ariaLabel} className={triggerClassName ?? 'h-9 w-[150px]'}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

export function DirectoryToolbar({
  search,
  onSearch,
  filters,
  onFilter,
  groupBy,
  onGroupBy,
  sort,
  onSort,
  canCreate,
  onAddUsers,
}: DirectoryToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
      <Input
        className="h-9 w-full sm:w-64"
        placeholder="Search name or email"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterField
          label="Role"
          ariaLabel="Filter by role"
          value={filters.role}
          onValueChange={(role) => onFilter({ ...filters, role: role as DirectoryFilters['role'] })}
          triggerClassName="h-9 w-[190px]"
        >
          <SelectItem value="all">All roles</SelectItem>
          {LEGACY_ROLES.map((role) => (
            <SelectItem key={role} value={role}>
              {roleLabel(role)}
            </SelectItem>
          ))}
        </FilterField>

        <FilterField
          label="Team"
          ariaLabel="Filter by team"
          value={filters.team}
          onValueChange={(team) => onFilter({ ...filters, team })}
          triggerClassName="h-9 w-[140px]"
        >
          <SelectItem value="all">All teams</SelectItem>
          {TEAM_OPTIONS.map((team) => (
            <SelectItem key={team} value={team}>
              {team.charAt(0).toUpperCase() + team.slice(1)}
            </SelectItem>
          ))}
        </FilterField>

        <FilterField
          label="Active"
          ariaLabel="Filter by active"
          value={filters.active}
          onValueChange={(active) =>
            onFilter({ ...filters, active: active as DirectoryFilters['active'] })
          }
          triggerClassName="h-9 w-[130px]"
        >
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
        </FilterField>

        <FilterField
          label="Accepts"
          ariaLabel="Filter by accepts tasks"
          value={filters.acceptsTasks}
          onValueChange={(acceptsTasks) =>
            onFilter({ ...filters, acceptsTasks: acceptsTasks as DirectoryFilters['acceptsTasks'] })
          }
          triggerClassName="h-9 w-[130px]"
        >
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </FilterField>
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
        <FilterField
          label="Group by"
          ariaLabel="Group by"
          value={groupBy}
          onValueChange={(value) => onGroupBy(value as GroupBy)}
          triggerClassName="h-9 w-[150px]"
        >
          {(Object.keys(GROUP_BY_LABELS) as GroupBy[]).map((key) => (
            <SelectItem key={key} value={key}>
              {GROUP_BY_LABELS[key]}
            </SelectItem>
          ))}
        </FilterField>

        <FilterField
          label="Sort"
          ariaLabel="Sort by"
          value={sort}
          onValueChange={(value) => onSort(value as SortKey)}
          triggerClassName="h-9 w-[120px]"
        >
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <SelectItem key={key} value={key}>
              {SORT_LABELS[key]}
            </SelectItem>
          ))}
        </FilterField>

        {canCreate && (
          <Button type="button" onClick={onAddUsers}>
            Add users
          </Button>
        )}
      </div>
    </div>
  );
}
