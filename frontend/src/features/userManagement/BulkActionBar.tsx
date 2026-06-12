// The bulk-action bar: appears when one or more rows are selected and
// applies a single patch across the whole selection.
//
// "Set active" / "Set inactive" fire immediately. "Change role",
// "Change team lead" and "Change manager" reveal a small inline control
// (a Select) plus an Apply button so the caller only ever sees the
// final patch.
//
// "Change role" is gated: it only shows when EVERY selected role is one
// the actor is allowed to assign (canAssign), so a manager can never bulk
// the bar into reassigning a peer/superior they couldn't touch one-by-one.
//
// Team lead / manager are real dropdowns (no free text): the page
// computes the eligible names for the CURRENT selection — same
// department (marketing/technical), active users only, intersected
// across the selected users — and passes them in. An empty list renders
// an explanatory hint instead of a control.
//
// Styling reuses the existing primary accent token (bg-primary/10) — no
// new colours.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { canAssign } from './rolePolicy';
import { roleLabel } from './roleLabels';

export interface BulkPatch {
  active?: boolean;
  role?: string;
  teamLead?: string;
  manager?: string;
}

export interface BulkActionBarProps {
  count: number;
  /** Distinct legacy roles among the selected users. */
  selectedRoles: string[];
  actorRole: string;
  /** Eligible team-lead names for the current selection (same department,
   *  active, valid for every selected user). */
  teamLeadOptions?: string[];
  /** Eligible manager names for the current selection. */
  managerOptions?: string[];
  onApply: (patch: BulkPatch) => void;
}

// Which inline editor (if any) is currently expanded.
type InlineMode = null | 'role' | 'teamLead' | 'manager';

export function BulkActionBar({
  count,
  selectedRoles,
  actorRole,
  teamLeadOptions = [],
  managerOptions = [],
  onApply,
}: BulkActionBarProps) {
  const [mode, setMode] = useState<InlineMode>(null);
  const [roleValue, setRoleValue] = useState('');
  const [nameValue, setNameValue] = useState('');

  if (count === 0) return null;

  const assignable = canAssign(actorRole);
  const canChangeRole =
    selectedRoles.length > 0 && selectedRoles.every((r) => assignable.includes(r as never));

  const reset = () => {
    setMode(null);
    setRoleValue('');
    setNameValue('');
  };

  const openMode = (next: InlineMode) => {
    setRoleValue('');
    setNameValue('');
    setMode(next);
  };

  const applyRole = () => {
    if (!roleValue) return;
    onApply({ role: roleValue });
    reset();
  };

  const applyName = () => {
    if (!nameValue) return;
    if (mode === 'teamLead') {
      onApply({ teamLead: nameValue });
    } else if (mode === 'manager') {
      onApply({ manager: nameValue });
    }
    reset();
  };

  const nameOpts = mode === 'teamLead' ? teamLeadOptions : managerOptions;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-primary/10 px-4 py-3">
      <span className="text-sm font-medium text-foreground">{count} selected</span>

      <Button type="button" variant="secondary" size="sm" onClick={() => onApply({ active: true })}>
        Set active
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onApply({ active: false })}
      >
        Set inactive
      </Button>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => openMode('teamLead')}
      >
        Change team lead
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={() => openMode('manager')}>
        Change manager
      </Button>

      {canChangeRole && (
        <Button type="button" variant="secondary" size="sm" onClick={() => openMode('role')}>
          Change role
        </Button>
      )}

      {mode === 'role' && (
        <div className="flex items-center gap-2">
          <Select value={roleValue} onValueChange={setRoleValue}>
            <SelectTrigger aria-label="New role" className="h-9 w-[190px]">
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              {assignable.map((role) => (
                <SelectItem key={role} value={role}>
                  {roleLabel(role)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" onClick={applyRole}>
            Apply
          </Button>
        </div>
      )}

      {(mode === 'teamLead' || mode === 'manager') &&
        (nameOpts.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {mode === 'teamLead'
              ? 'No eligible team leads for this selection.'
              : 'No eligible managers for this selection.'}
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <Select value={nameValue} onValueChange={setNameValue}>
              <SelectTrigger
                aria-label={mode === 'teamLead' ? 'New team lead' : 'New manager'}
                className="h-9 w-[220px]"
              >
                <SelectValue
                  placeholder={mode === 'teamLead' ? 'Select a team lead' : 'Select a manager'}
                />
              </SelectTrigger>
              <SelectContent>
                {nameOpts.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" onClick={applyName}>
              Apply
            </Button>
          </div>
        ))}
    </div>
  );
}
