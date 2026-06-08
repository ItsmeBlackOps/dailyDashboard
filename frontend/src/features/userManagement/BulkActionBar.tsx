// The bulk-action bar: appears when one or more rows are selected and
// applies a single patch across the whole selection.
//
// "Set active" / "Set inactive" fire immediately. "Change role",
// "Change team lead" and "Change manager" reveal a small inline control
// (a role Select, or a free-text Input) plus an Apply button so the
// caller only ever sees the final patch.
//
// "Change role" is gated: it only shows when EVERY selected role is one
// the actor is allowed to assign (canAssign), so a manager can never bulk
// the bar into reassigning a peer/superior they couldn't touch one-by-one.
//
// Styling reuses the existing primary accent token (bg-primary/10) — no
// new colours.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  /** Display names offered as autocomplete for team lead / manager,
   *  restoring the legacy <datalist> suggestions to reduce typos. */
  nameOptions?: string[];
  onApply: (patch: BulkPatch) => void;
}

// Which inline editor (if any) is currently expanded.
type InlineMode = null | 'role' | 'teamLead' | 'manager';

export function BulkActionBar({
  count,
  selectedRoles,
  actorRole,
  nameOptions = [],
  onApply,
}: BulkActionBarProps) {
  const [mode, setMode] = useState<InlineMode>(null);
  const [roleValue, setRoleValue] = useState('');
  const [textValue, setTextValue] = useState('');

  if (count === 0) return null;

  const assignable = canAssign(actorRole);
  const canChangeRole =
    selectedRoles.length > 0 && selectedRoles.every((r) => assignable.includes(r as never));

  const reset = () => {
    setMode(null);
    setRoleValue('');
    setTextValue('');
  };

  const openMode = (next: InlineMode) => {
    setRoleValue('');
    setTextValue('');
    setMode(next);
  };

  const applyRole = () => {
    if (!roleValue) return;
    onApply({ role: roleValue });
    reset();
  };

  const applyText = () => {
    if (mode === 'teamLead') {
      onApply({ teamLead: textValue });
    } else if (mode === 'manager') {
      onApply({ manager: textValue });
    }
    reset();
  };

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

      {(mode === 'teamLead' || mode === 'manager') && (
        <div className="flex items-center gap-2">
          <Input
            aria-label={mode === 'teamLead' ? 'New team lead' : 'New manager'}
            className="h-9 w-[200px]"
            placeholder={mode === 'teamLead' ? 'Team lead name' : 'Manager name'}
            list={nameOptions.length ? 'bulk-name-suggestions' : undefined}
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
          />
          {nameOptions.length > 0 && (
            <datalist id="bulk-name-suggestions">
              {nameOptions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}
          <Button type="button" size="sm" onClick={applyText}>
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
