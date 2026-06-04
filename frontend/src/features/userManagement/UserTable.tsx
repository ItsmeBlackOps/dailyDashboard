// The directory table: a themed <Table> with a column-header row, then —
// for each group returned by groupUsers — an optional group-header row
// followed by that group's UserRows.
//
// The group header is skipped when there is a single synthetic group
// (group-by 'none', which groupUsers keys as 'all'); a flat list needs no
// banner. canToggleActive / canToggleAccepts are per-user predicates so
// the page can apply rolePolicy on a row-by-row basis.

import { Fragment } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UserRow } from './UserRow';
import type { ManageableUser, UserGroup } from './grouping';

const COLUMN_COUNT = 7;

// Synthetic single-bucket keys produced by groupUsers for the flat case.
const FLAT_GROUP_KEYS = new Set(['all', 'none']);

export interface UserTableProps {
  groups: UserGroup[];
  selectedEmails: Set<string>;
  canToggleActive: (user: ManageableUser) => boolean;
  canToggleAccepts: (user: ManageableUser) => boolean;
  onSelect: (user: ManageableUser, selected: boolean) => void;
  onOpen: (user: ManageableUser) => void;
  onToggleActive: (user: ManageableUser, value: boolean) => void;
  onToggleAccepts: (user: ManageableUser, value: boolean) => void;
}

export function UserTable({
  groups,
  selectedEmails,
  canToggleActive,
  canToggleAccepts,
  onSelect,
  onOpen,
  onToggleActive,
  onToggleAccepts,
}: UserTableProps) {
  const showGroupHeaders = !(groups.length === 1 && FLAT_GROUP_KEYS.has(groups[0].groupKey));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>Name / Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Team</TableHead>
          <TableHead>Manager</TableHead>
          <TableHead>Active</TableHead>
          <TableHead>Accepts</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <Fragment key={group.groupKey}>
            {showGroupHeaders && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={COLUMN_COUNT}
                  className="bg-muted/40 text-xs text-muted-foreground"
                >
                  {group.label} ({group.users.length})
                </TableCell>
              </TableRow>
            )}
            {group.users.map((user) => (
              <UserRow
                key={user.email}
                user={user}
                selected={selectedEmails.has(user.email)}
                canToggleActive={canToggleActive(user)}
                canToggleAccepts={canToggleAccepts(user)}
                onSelect={onSelect}
                onOpen={onOpen}
                onToggleActive={onToggleActive}
                onToggleAccepts={onToggleAccepts}
              />
            ))}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}
