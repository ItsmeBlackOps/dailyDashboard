// A single directory row. Renders inside a <Table>/<TableBody>.
//
// Interaction contract:
//   - clicking anywhere on the row (outside an interactive control) opens
//     the user via onOpen(user);
//   - the checkbox + the two switches stop propagation so flipping them
//     never also opens the drawer.
//
// All styling uses existing semantic tokens / primitives — no new colours.

import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { TableCell, TableRow } from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { RoleBadge } from './RoleBadge';
import { userDisplayName, type ManageableUser } from './grouping';

export interface UserRowProps {
  user: ManageableUser;
  selected: boolean;
  canToggleActive: boolean;
  canToggleAccepts: boolean;
  onSelect: (user: ManageableUser, selected: boolean) => void;
  onOpen: (user: ManageableUser) => void;
  onToggleActive: (user: ManageableUser, value: boolean) => void;
  onToggleAccepts: (user: ManageableUser, value: boolean) => void;
}

const DASH = '—';

// Wrapper that stops a click from bubbling up to the row's onOpen.
function StopClick({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children}
    </span>
  );
}

function ToggleCell({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const control = (
    <Switch
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(v) => onChange(v)}
    />
  );

  return (
    <StopClick>
      {disabled ? (
        // Provider is hoisted to the page (UserManagementPage / PageShell);
        // rendering one per cell was 2xN providers for N rows.
        <Tooltip>
          {/* span keeps the tooltip working over a disabled control */}
          <TooltipTrigger asChild>
            <span className="inline-flex">{control}</span>
          </TooltipTrigger>
          <TooltipContent>Not allowed for your role</TooltipContent>
        </Tooltip>
      ) : (
        control
      )}
    </StopClick>
  );
}

export function UserRow({
  user,
  selected,
  canToggleActive,
  canToggleAccepts,
  onSelect,
  onOpen,
  onToggleActive,
  onToggleAccepts,
}: UserRowProps) {
  const hasAccepts = user.acceptsTasks !== undefined;

  return (
    <TableRow
      className="cursor-pointer"
      data-state={selected ? 'selected' : undefined}
      onClick={() => onOpen(user)}
    >
      <TableCell className="w-8">
        <StopClick>
          <Checkbox
            aria-label="Select row"
            checked={selected}
            onCheckedChange={(v) => onSelect(user, v === true)}
          />
        </StopClick>
      </TableCell>

      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium text-foreground">{userDisplayName(user)}</span>
          <span className="text-xs text-muted-foreground">{user.email}</span>
        </div>
      </TableCell>

      <TableCell>
        <RoleBadge role={user.role} />
      </TableCell>

      <TableCell className="text-muted-foreground">{user.team || DASH}</TableCell>

      <TableCell className="text-muted-foreground">{user.manager || DASH}</TableCell>

      <TableCell>
        <ToggleCell
          label="Active"
          checked={user.active}
          disabled={!canToggleActive}
          onChange={(v) => onToggleActive(user, v)}
        />
      </TableCell>

      <TableCell>
        {hasAccepts ? (
          <ToggleCell
            label="Accepts tasks"
            checked={Boolean(user.acceptsTasks)}
            disabled={!canToggleAccepts}
            onChange={(v) => onToggleAccepts(user, v)}
          />
        ) : (
          <span className="text-muted-foreground">{DASH}</span>
        )}
      </TableCell>
    </TableRow>
  );
}
