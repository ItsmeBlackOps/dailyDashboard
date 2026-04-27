import * as React from 'react';
import { useMemo, useState, useEffect, useRef } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ── Module-level cache ───────────────────────────────────────────────────────
let cachedClients: string[] | null = null;
let inflightFetch: Promise<string[]> | null = null;

export function invalidateClientsCache() {
  cachedClients = null;
  inflightFetch = null;
}

async function fetchClients(): Promise<string[]> {
  if (cachedClients) return cachedClients;
  if (inflightFetch) return inflightFetch;
  const token = localStorage.getItem('token');
  inflightFetch = fetch('/api/candidates/distinct-clients', {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then((r) => r.json())
    .then((d) => {
      cachedClients = d.clients || [];
      inflightFetch = null;
      return cachedClients!;
    })
    .catch(() => {
      inflightFetch = null;
      return [];
    });
  return inflightFetch;
}

// ── Props ────────────────────────────────────────────────────────────────────
export interface CompanyComboboxProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

// ── Component ────────────────────────────────────────────────────────────────
export function CompanyCombobox({
  value,
  onChange,
  placeholder = 'Select client…',
  disabled,
  className,
}: CompanyComboboxProps) {
  const [open, setOpen] = useState(false);
  const [clients, setClients] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'list' | 'addNew'>('list');

  // Add-new state
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dupeMsg, setDupeMsg] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);

  // Load clients on mount
  useEffect(() => {
    fetchClients().then(setClients);
  }, []);

  // Auto-focus add-new input when mode switches
  useEffect(() => {
    if (mode === 'addNew') {
      setTimeout(() => addInputRef.current?.focus(), 0);
    }
  }, [mode]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.toLowerCase().includes(q));
  }, [clients, search]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset add-new state when closing
      setMode('list');
      setSearch('');
      setNewName('');
      setAddError('');
      setDupeMsg('');
    }
  }

  const pasteBlockHandlers = {
    onPaste: (e: React.ClipboardEvent) => e.preventDefault(),
    onDrop: (e: React.DragEvent) => e.preventDefault(),
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
      }
    },
  };

  async function handleSave() {
    const trimmed = newName.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      setAddError('Name is required');
      return;
    }
    setSaving(true);
    setAddError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/candidates/end-clients', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: trimmed }),
      });
      const payload = await res.json();
      if (res.ok && payload.success) {
        invalidateClientsCache();
        const refreshed = await fetchClients();
        setClients(refreshed);
        onChange(payload.client);
        setOpen(false);
      } else if (res.status === 409) {
        invalidateClientsCache();
        const refreshed = await fetchClients();
        setClients(refreshed);
        onChange(payload.existing);
        setDupeMsg('Company already exists; selected the existing one');
        setOpen(false);
      } else {
        setAddError(payload.error || 'Failed to add company');
      }
    } catch {
      setAddError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setMode('list');
    setNewName('');
    setAddError('');
  }

  return (
    <>
      {dupeMsg && (
        <p className="text-xs text-amber-500 mt-1">{dupeMsg}</p>
      )}
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={`w-full justify-between ${className || ''}`}
          >
            <span className="truncate">{value || placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0">
          <Command>
            {mode === 'list' ? (
              <>
                <CommandInput
                  placeholder="Search company…"
                  value={search}
                  onValueChange={setSearch}
                  {...pasteBlockHandlers}
                />
                <CommandList>
                  <CommandEmpty>No companies match &quot;{search}&quot;</CommandEmpty>
                  <CommandGroup heading="Existing companies">
                    {filteredClients.map((name) => (
                      <CommandItem
                        key={name}
                        value={name}
                        onSelect={() => {
                          onChange(name);
                          setOpen(false);
                        }}
                      >
                        <Check
                          className={`mr-2 h-4 w-4 ${value === name ? 'opacity-100' : 'opacity-0'}`}
                        />
                        {name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <CommandGroup>
                    <CommandItem
                      onSelect={() => setMode('addNew')}
                      className="text-aurora-violet font-medium"
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add new company
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </>
            ) : (
              <div className="p-3 space-y-2">
                <p className="text-sm font-medium">Add new company</p>
                <Input
                  ref={addInputRef}
                  placeholder="Company name"
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    if (addError) setAddError('');
                  }}
                  {...pasteBlockHandlers}
                  onKeyDown={(e) => {
                    // paste block
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
                      e.preventDefault();
                    }
                    // Enter to save
                    if (e.key === 'Enter') handleSave();
                  }}
                  aria-label="New company name"
                />
                {addError && (
                  <p className="text-xs text-destructive">{addError}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancel}
                    disabled={saving}
                    type="button"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saving}
                    type="button"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}

export default CompanyCombobox;
