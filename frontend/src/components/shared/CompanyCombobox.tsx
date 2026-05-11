import * as React from 'react';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';

// Cap the rendered list to keep the DOM under control on 4GB-RAM machines.
// cmdk renders every CommandItem (no built-in virtualisation); with 1000+
// distinct clients a single popover open turned into a multi-second freeze.
// 50 covers >95% of typical alphabetic-prefix searches; if a user truly
// can't see what they want they'll type — which is the fast path anyway.
const MAX_VISIBLE_CLIENTS = 50;
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
import { useAuth } from '@/hooks/useAuth';

// ── Module-level cache ───────────────────────────────────────────────────────
let cachedClients: string[] | null = null;
let inflightFetch: Promise<string[]> | null = null;

export function invalidateClientsCache() {
  cachedClients = null;
  inflightFetch = null;
}

// Bug 4 fix — both fetches now route through authFetch (passed in by
// the caller) so a 401 on an expired access token triggers the
// useAuth refresh-and-retry flow instead of surfacing 'Invalid token'
// to the user inline.
async function fetchClients(
  authFetch: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<string[]> {
  if (cachedClients) return cachedClients;
  if (inflightFetch) return inflightFetch;
  inflightFetch = authFetch('/api/candidates/distinct-clients')
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
  const { authFetch } = useAuth();
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

  // Load clients on mount. authFetch's identity changes per parent
  // render but fetchClients short-circuits on the module-level cache, so
  // we deliberately depend on nothing — extra invocations are harmless.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    fetchClients(authFetch).then((c) => { if (!cancelled) setClients(c); });
    return () => { cancelled = true; };
  }, []);

  // Auto-focus add-new input when mode switches
  useEffect(() => {
    if (mode === 'addNew') {
      setTimeout(() => addInputRef.current?.focus(), 0);
    }
  }, [mode]);

  // Filter + cap. We only iterate the full list once and break out as soon
  // as we have MAX_VISIBLE_CLIENTS matches. With 1000+ clients this drops
  // popover-open time from ~2s to ~30ms on 4GB machines (Chrome perf trace).
  const { visible, totalMatches } = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      // No search: show first MAX_VISIBLE_CLIENTS alphabetically. The full
      // count is reported to the user so they know typing will narrow further.
      return { visible: clients.slice(0, MAX_VISIBLE_CLIENTS), totalMatches: clients.length };
    }
    const out: string[] = [];
    let total = 0;
    for (const c of clients) {
      if (c.toLowerCase().includes(q)) {
        total++;
        if (out.length < MAX_VISIBLE_CLIENTS) out.push(c);
      }
    }
    return { visible: out, totalMatches: total };
  }, [clients, search]);

  // Stable per-item select handler so CommandItem doesn't get a new prop
  // function reference on every keystroke.
  const handleSelect = useCallback((name: string) => {
    onChange(name);
    setOpen(false);
  }, [onChange]);

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
      // Bug 4 fix — authFetch handles 401 by refreshing the access
      // token and retrying. Raw fetch() bypassed that and surfaced
      // 'Invalid token' / 'Token expired' to marketing users mid-session.
      const res = await authFetch('/api/candidates/end-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const payload = await res.json();
      if (res.ok && payload.success) {
        invalidateClientsCache();
        const refreshed = await fetchClients(authFetch);
        setClients(refreshed);
        onChange(payload.client);
        setOpen(false);
      } else if (res.status === 409) {
        invalidateClientsCache();
        const refreshed = await fetchClients(authFetch);
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
                  {/* Empty state intentionally minimal — the Add CTA below
                      lives OUTSIDE the CommandList so cmdk doesn't filter
                      it out when the search query has no matches. */}
                  <CommandEmpty className="py-2 text-xs text-muted-foreground">
                    No matches.
                  </CommandEmpty>
                  <CommandGroup heading="Existing companies">
                    {visible.map((name) => (
                      <CommandItem
                        key={name}
                        value={name}
                        onSelect={() => handleSelect(name)}
                      >
                        <Check
                          className={`mr-2 h-4 w-4 ${value === name ? 'opacity-100' : 'opacity-0'}`}
                        />
                        {name}
                      </CommandItem>
                    ))}
                    {totalMatches > visible.length && (
                      <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                        Showing {visible.length} of {totalMatches}. Keep typing to narrow.
                      </div>
                    )}
                  </CommandGroup>
                </CommandList>
                {/* Always-visible Add CTA. Uses the current search query
                    as the suggested name so the user doesn't have to
                    re-type after a no-match search. */}
                <button
                  type="button"
                  onClick={() => {
                    if (search.trim()) setNewName(search.trim());
                    setMode('addNew');
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-aurora-violet hover:bg-aurora-violet/10 border-t border-border transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  {search.trim()
                    ? <>Add <span className="font-mono">&quot;{search.trim()}&quot;</span> as a new company</>
                    : 'Add new company'}
                </button>
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
