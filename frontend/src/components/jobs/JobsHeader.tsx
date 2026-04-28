import { Search, RefreshCw, LayoutList, Grid3X3, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SortKey } from './types';

interface JobsHeaderProps {
  candidateName?: string;
  totalJobs: number;
  filteredCount: number;
  search: string;
  onSearchChange: (v: string) => void;
  sort: SortKey;
  onSortChange: (v: SortKey) => void;
  view: 'split' | 'cards';
  onViewChange: (v: 'split' | 'cards') => void;
  onRefresh: () => void;
  refreshing: boolean;
  tab: string;
  onTabChange: (v: string) => void;
  savedCount: number;
  remoteCount: number;
  sessionStatus?: string;
}

export default function JobsHeader({
  candidateName,
  totalJobs,
  filteredCount,
  search,
  onSearchChange,
  sort,
  onSortChange,
  view,
  onViewChange,
  onRefresh,
  refreshing,
  tab,
  onTabChange,
  savedCount,
  remoteCount,
  sessionStatus,
}: JobsHeaderProps) {
  const tabs = [
    { key: 'all', label: 'All', count: totalJobs },
    { key: 'remote', label: 'Remote only', count: remoteCount },
    { key: 'saved', label: 'Saved', count: savedCount },
  ];

  return (
    <div className="border-b border-white/[0.06] bg-card/30 px-4 py-3 space-y-3">
      {/* Row 1: name + status + refresh */}
      <div className="flex items-center gap-3">
        {candidateName && (
          <div>
            <span className="text-[13px] font-semibold text-foreground">{candidateName}</span>
            <span className="text-[11px] text-muted-foreground ml-2">· Jobs session</span>
          </div>
        )}
        {sessionStatus === 'running' && (
          <span className="inline-flex items-center gap-1.5 text-[10.5px] font-mono text-aurora-cyan/80 bg-aurora-cyan/10 border border-aurora-cyan/20 px-2 py-0.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-aurora-cyan animate-pulse" />
            Searching…
          </span>
        )}
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Row 2: tabs + search + sort + view */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Tabs */}
        <div className="flex gap-0.5 p-0.5 bg-white/[0.04] border border-white/[0.08] rounded-xl">
          {tabs.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => onTabChange(key)}
              className={cn(
                'px-3 py-1 rounded-[10px] text-[12px] transition-colors',
                tab === key
                  ? 'bg-aurora-violet/20 text-aurora-violet font-medium'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}{' '}
              <span className="font-mono text-[10.5px] opacity-70">{count}</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search title, company, location…"
            className="pl-8 pr-7 h-8 text-[12.5px]"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Result count */}
          <span className="font-mono text-[10.5px] text-muted-foreground uppercase tracking-wider">
            <span className="text-foreground">{filteredCount}</span> / {totalJobs}
          </span>

          {/* Sort */}
          <Select value={sort} onValueChange={(v) => onSortChange(v as SortKey)}>
            <SelectTrigger className="h-8 w-36 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date-desc">Newest first</SelectItem>
              <SelectItem value="date-asc">Oldest first</SelectItem>
              <SelectItem value="company-asc">Company A→Z</SelectItem>
              <SelectItem value="title-asc">Title A→Z</SelectItem>
            </SelectContent>
          </Select>

          {/* View toggle */}
          <div className="flex border border-white/[0.1] rounded-lg overflow-hidden">
            <button
              onClick={() => onViewChange('split')}
              title="Split view"
              className={cn(
                'flex items-center justify-center w-8 h-8 transition-colors',
                view === 'split' ? 'bg-aurora-violet/20 text-aurora-violet' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <LayoutList className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onViewChange('cards')}
              title="Cards grid"
              className={cn(
                'flex items-center justify-center w-8 h-8 transition-colors',
                view === 'cards' ? 'bg-aurora-violet/20 text-aurora-violet' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Grid3X3 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
