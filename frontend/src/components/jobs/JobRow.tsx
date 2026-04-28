import { MapPin, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { shortLoc, relTime, ATS_LABEL, companyInitials, companyHue } from '@/utils/jobsFormatting';
import type { Job } from './types';

interface LogoProps {
  company: string;
  size?: number;
}

export function CompanyLogo({ company, size = 32 }: LogoProps) {
  const h = companyHue(company);
  const initials = companyInitials(company);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 30) % 360} 70% 38%))`,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: size * 0.38,
        color: 'rgba(255,255,255,0.96)',
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.2), 0 4px 10px -4px hsl(${h} 70% 50% / 0.45)`,
      }}
    >
      {initials}
    </div>
  );
}

const REMOTE_CLASS: Record<string, string> = {
  remote: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  hybrid: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30',
  onsite: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
};

const REMOTE_DOT: Record<string, string> = {
  remote: 'bg-emerald-400',
  hybrid: 'bg-fuchsia-400',
  onsite: 'bg-amber-400',
};

interface JobRowProps {
  job: Job;
  selected: boolean;
  starred: boolean;
  onSelect: (job: Job) => void;
  onStar: () => void;
}

export default function JobRow({ job, selected, starred, onSelect, onStar }: JobRowProps) {
  const postedDate = new Date(job.date_posted);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(job)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(job)}
      className={cn(
        'grid items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors border-b border-white/[0.04]',
        'hover:bg-white/[0.03]',
        selected && 'bg-aurora-violet/10 border-l-2 border-l-aurora-violet',
      )}
      style={{ gridTemplateColumns: '36px minmax(0,1.6fr) minmax(0,1fr) 100px 90px 72px 32px' }}
      data-testid="job-row"
    >
      {/* Logo */}
      <CompanyLogo company={job.company} size={32} />

      {/* Title + Company */}
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground truncate">{job.title}</div>
        <div className="text-[11px] text-muted-foreground truncate mt-0.5">{job.company}</div>
      </div>

      {/* Location */}
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground min-w-0">
        <MapPin className="h-3 w-3 shrink-0 opacity-50" />
        <span className="truncate">{shortLoc(job.location)}</span>
      </div>

      {/* Remote pill */}
      <div>
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium border capitalize',
            REMOTE_CLASS[job.remote_type] ?? 'bg-muted/40 text-muted-foreground border-border',
          )}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full', REMOTE_DOT[job.remote_type])} />
          {job.remote_type}
        </span>
      </div>

      {/* ATS pill */}
      <div>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-white/[0.06] text-foreground/70 border border-white/10">
          {ATS_LABEL[job.ats] ?? job.ats}
        </span>
      </div>

      {/* Rel time */}
      <div className="text-[11px] font-mono text-muted-foreground">
        {relTime(postedDate)}
      </div>

      {/* Star */}
      <button
        aria-label={starred ? 'Remove bookmark' : 'Bookmark'}
        onClick={(e) => { e.stopPropagation(); onStar(); }}
        className={cn(
          'flex items-center justify-center w-6 h-6 rounded transition-colors hover:bg-white/10',
          starred ? 'text-amber-400' : 'text-muted-foreground/40',
        )}
        data-testid="star-btn"
      >
        <Star className={cn('h-3.5 w-3.5', starred && 'fill-amber-400')} />
      </button>
    </div>
  );
}
