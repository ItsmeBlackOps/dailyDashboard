import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

export interface MultiSelectDropdownOption {
  value: string;
  label: string;
  sublabel?: string;
}

export interface MultiSelectDropdownProps {
  label: string;
  options: MultiSelectDropdownOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export default function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  disabled,
  placeholder,
  className,
}: MultiSelectDropdownProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel || '').toLowerCase().includes(q)
    );
  }, [options, search]);

  const toggle = (value: string) => {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value));
    else onChange([...selected, value]);
  };

  const selectAll = () => onChange(filtered.map((o) => o.value));
  const clearAll = () => onChange([]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={`gap-2 justify-between ${className || ''}`}
        >
          <span className="text-xs">{label}</span>
          {selected.length > 0 ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {selected.length}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">
              {placeholder || `All ${label}`}
            </span>
          )}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${label.toLowerCase()}...`}
          className="h-8 text-xs mb-2"
        />
        <div className="flex justify-between mb-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={selectAll}
          >
            Select all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={clearAll}
          >
            Clear
          </Button>
        </div>
        <div className="max-h-64 overflow-auto space-y-1">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No matches
            </p>
          )}
          {filtered.map((opt) => {
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex items-start gap-2 p-1.5 rounded hover:bg-accent cursor-pointer"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggle(opt.value)}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate">{opt.label}</div>
                  {opt.sublabel && (
                    <div className="text-[10px] text-muted-foreground truncate">
                      {opt.sublabel}
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
