import { SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { shortLoc, ATS_LABEL } from '@/utils/jobsFormatting';
import type { Job, JobFilters } from './types';

interface FilterRailProps {
  filters: JobFilters;
  setFilters: (f: JobFilters) => void;
  jobs: Job[];
  starredCount: number;
}

function FilterSection({
  label,
  children,
  last = false,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={cn('px-4 py-3', !last && 'border-b border-white/[0.06]')}>
      <div className="text-[9.5px] font-mono uppercase tracking-widest text-muted-foreground/60 font-semibold mb-2.5">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

interface ChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Chip({ active, onClick, children }: ChipProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border transition-colors',
        active
          ? 'bg-aurora-violet/20 text-aurora-violet border-aurora-violet/40'
          : 'bg-white/[0.04] text-muted-foreground border-white/10 hover:border-white/20 hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

const REMOTE_DOT: Record<string, string> = {
  remote: 'bg-emerald-400',
  hybrid: 'bg-fuchsia-400',
  onsite: 'bg-amber-400',
};

export default function FilterRail({ filters, setFilters, jobs, starredCount }: FilterRailProps) {
  const toggle = (key: keyof Pick<JobFilters, 'remote' | 'ats' | 'state' | 'company'>, val: string) => {
    const cur = new Set(filters[key]);
    cur.has(val) ? cur.delete(val) : cur.add(val);
    setFilters({ ...filters, [key]: [...cur] });
  };

  const remoteCounts: Record<string, number> = { remote: 0, hybrid: 0, onsite: 0 };
  jobs.forEach((j) => { remoteCounts[j.remote_type] = (remoteCounts[j.remote_type] || 0) + 1; });

  const atsCounts: [string, number][] = (() => {
    const c: Record<string, number> = {};
    jobs.forEach((j) => { c[j.ats] = (c[j.ats] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  })();

  const stateCounts: [string, number][] = (() => {
    const c: Record<string, number> = {};
    jobs.forEach((j) => {
      const s = shortLoc(j.location).split(',').slice(-1)[0].trim();
      if (s && s !== '—') c[s] = (c[s] || 0) + 1;
    });
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 14);
  })();

  const companyCounts: [string, number][] = (() => {
    const c: Record<string, number> = {};
    jobs.forEach((j) => { c[j.company] = (c[j.company] || 0) + 1; });
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 18);
  })();

  const hasFilters =
    filters.remote.length > 0 ||
    filters.ats.length > 0 ||
    filters.state.length > 0 ||
    filters.company.length > 0 ||
    filters.onlyStarred;

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-card/50 border-r border-white/[0.06]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-aurora-violet" />
          <span className="font-semibold text-[13.5px]">Filters</span>
        </div>
        {hasFilters && (
          <button
            onClick={() => setFilters({ remote: [], ats: [], state: [], company: [], onlyStarred: false })}
            className="text-[10.5px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      <FilterSection label="Status">
        <Chip
          active={filters.onlyStarred}
          onClick={() => setFilters({ ...filters, onlyStarred: !filters.onlyStarred })}
        >
          <span className="text-amber-400">★</span> Saved
          <span className="font-mono text-[10px] text-muted-foreground/70">{starredCount}</span>
        </Chip>
      </FilterSection>

      <FilterSection label="Work Mode">
        {(['remote', 'hybrid', 'onsite'] as const).map((r) => (
          <Chip key={r} active={filters.remote.includes(r)} onClick={() => toggle('remote', r)}>
            <span className={cn('w-1.5 h-1.5 rounded-full', REMOTE_DOT[r])} />
            {r.charAt(0).toUpperCase() + r.slice(1)}
            <span className="font-mono text-[10px] text-muted-foreground/70">{remoteCounts[r] || 0}</span>
          </Chip>
        ))}
      </FilterSection>

      {stateCounts.length > 0 && (
        <FilterSection label="Top States">
          {stateCounts.map(([s, n]) => (
            <Chip key={s} active={filters.state.includes(s)} onClick={() => toggle('state', s)}>
              {s}
              <span className="font-mono text-[10px] text-muted-foreground/70">{n}</span>
            </Chip>
          ))}
        </FilterSection>
      )}

      {atsCounts.length > 0 && (
        <FilterSection label="ATS">
          {atsCounts.map(([a, n]) => (
            <Chip key={a} active={filters.ats.includes(a)} onClick={() => toggle('ats', a)}>
              {ATS_LABEL[a] ?? a}
              <span className="font-mono text-[10px] text-muted-foreground/70">{n}</span>
            </Chip>
          ))}
        </FilterSection>
      )}

      {companyCounts.length > 0 && (
        <FilterSection label="Top Companies" last>
          {companyCounts.map(([c, n]) => (
            <Chip key={c} active={filters.company.includes(c)} onClick={() => toggle('company', c)}>
              {c}
              <span className="font-mono text-[10px] text-muted-foreground/70">{n}</span>
            </Chip>
          ))}
        </FilterSection>
      )}
    </div>
  );
}
