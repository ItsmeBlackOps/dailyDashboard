import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth, API_URL, SOCKET_URL } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { shortLoc } from '@/utils/jobsFormatting';
import FilterRail from '@/components/jobs/FilterRail';
import JobRow, { CompanyLogo } from '@/components/jobs/JobRow';
import JobDetailPanel from '@/components/jobs/JobDetailPanel';
import JobsHeader from '@/components/jobs/JobsHeader';
import type { Job, JobFilters, JobSessionResponse, SortKey } from '@/components/jobs/types';
import { ATS_LABEL, relTime } from '@/utils/jobsFormatting';
import { cn } from '@/lib/utils';
import { ExternalLink, MapPin, Star } from 'lucide-react';

// ── Starred hook ─────────────────────────────────────────────────────────────
function useStarred() {
  const [starred, setStarred] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('dd_starred_jobs');
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const toggle = useCallback((id: string) => {
    setStarred((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      try { localStorage.setItem('dd_starred_jobs', JSON.stringify([...n])); } catch { /* ignore */ }
      return n;
    });
  }, []);
  return [starred, toggle] as const;
}

// ── JobCard for cards grid ────────────────────────────────────────────────────
function JobCard({ job, selected, starred, onSelect, onStar }: {
  job: Job; selected: boolean; starred: boolean; onSelect: (j: Job) => void; onStar: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(job)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(job)}
      className={cn(
        'rounded-xl border bg-card p-4 cursor-pointer transition-colors hover:border-aurora-violet/30',
        selected && 'border-aurora-violet/50 bg-aurora-violet/5',
      )}
    >
      <div className="flex items-start gap-3 mb-3">
        <CompanyLogo company={job.company} size={40} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[14.5px] leading-tight line-clamp-2">{job.title}</div>
          <div className="text-[12px] text-muted-foreground mt-0.5">{job.company}</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onStar(); }}
          className={cn('shrink-0 mt-0.5', starred ? 'text-amber-400' : 'text-muted-foreground/40')}
        >
          <Star className={cn('h-4 w-4', starred && 'fill-amber-400')} />
        </button>
      </div>

      <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground mb-3">
        <MapPin className="h-3 w-3 opacity-50" />
        <span>{shortLoc(job.location)}</span>
        <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
        <span className="font-mono">{relTime(new Date(job.date_posted))}</span>
      </div>

      <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-3 mb-3">
        {job.snippet}
      </p>

      <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] bg-white/[0.06] border border-white/10 text-foreground/70">
          via {ATS_LABEL[job.ats] ?? job.ats}
        </span>
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[11px] text-aurora-violet hover:text-aurora-violet/80 transition-colors"
        >
          Apply <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <Star className="h-7 w-7 text-destructive/60" />
      </div>
      <div className="font-semibold text-[15px] text-foreground/80 mb-1.5">No jobs match those filters</div>
      <div className="text-[12.5px] max-w-[260px] leading-relaxed">
        Try clearing a filter, broadening your search, or switching to All.
      </div>
    </div>
  );
}

// ── JobsPage ──────────────────────────────────────────────────────────────────
export default function JobsPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isRefetching, refetch } = useQuery<JobSessionResponse>({
    queryKey: ['job-session', sessionId],
    queryFn: async () => {
      const res = await authFetch(`${API_URL}/api/jobs/sessions/${sessionId}`);
      if (!res.ok) throw new Error('Failed to load session');
      return res.json();
    },
    enabled: !!sessionId,
    refetchInterval: (q) => {
      const d = q.state.data as JobSessionResponse | undefined;
      return d?.session?.status === 'running' ? 5000 : false;
    },
  });

  // Socket integration
  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    const token = localStorage.getItem('accessToken') || '';
    const socket = io(SOCKET_URL, { autoConnect: false, transports: ['websocket'], auth: { token } });
    socketRef.current = socket;

    socket.on('jobSearchComplete', (payload: { sessionId?: string; totalFound?: number }) => {
      if (payload?.sessionId && payload.sessionId !== sessionId) return;
      toast({ title: 'Job search complete', description: `${payload?.totalFound ?? 'Results'} matches found` });
      queryClient.invalidateQueries({ queryKey: ['job-session', sessionId] });
    });

    socket.on('tailorResumeComplete', (payload: { sessionId?: string }) => {
      if (payload?.sessionId && payload.sessionId !== sessionId) return;
      toast({ title: 'Tailored resume ready', description: 'Download from the detail panel.' });
      queryClient.invalidateQueries({ queryKey: ['job-session', sessionId] });
    });

    socket.on('tailorResumeError', (payload: { sessionId?: string; error?: string }) => {
      if (payload?.sessionId && payload.sessionId !== sessionId) return;
      toast({ title: 'Tailor failed', description: payload?.error ?? 'Unknown error', variant: 'destructive' });
      queryClient.invalidateQueries({ queryKey: ['job-session', sessionId] });
    });

    socket.connect();
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [sessionId, queryClient, toast]);

  const [starred, toggleStar] = useStarred();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<JobFilters>({
    remote: [], ats: [], state: [], company: [], onlyStarred: false,
  });
  const [sort, setSort] = useState<SortKey>('date-desc');
  const [tab, setTab] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'split' | 'cards'>('split');

  const allJobs: Job[] = data?.jobs ?? [];
  const tailored = data?.tailored ?? {};

  const filtered = useMemo(() => {
    let result = allJobs;
    if (tab === 'saved') result = result.filter((j) => starred.has(j.id));
    if (tab === 'remote') result = result.filter((j) => j.remote_type === 'remote');
    if (filters.onlyStarred) result = result.filter((j) => starred.has(j.id));
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.company.toLowerCase().includes(q) ||
          (j.snippet ?? '').toLowerCase().includes(q) ||
          (j.location ?? '').toLowerCase().includes(q),
      );
    }
    if (filters.remote.length) result = result.filter((j) => filters.remote.includes(j.remote_type));
    if (filters.ats.length) result = result.filter((j) => filters.ats.includes(j.ats));
    if (filters.company.length) result = result.filter((j) => filters.company.includes(j.company));
    if (filters.state.length) {
      result = result.filter((j) => {
        const st = shortLoc(j.location).split(',').slice(-1)[0].trim();
        return filters.state.includes(st);
      });
    }
    const sorted = [...result];
    if (sort === 'date-desc') sorted.sort((a, b) => new Date(b.date_posted).getTime() - new Date(a.date_posted).getTime());
    if (sort === 'date-asc') sorted.sort((a, b) => new Date(a.date_posted).getTime() - new Date(b.date_posted).getTime());
    if (sort === 'company-asc') sorted.sort((a, b) => a.company.localeCompare(b.company));
    if (sort === 'title-asc') sorted.sort((a, b) => a.title.localeCompare(b.title));
    return sorted;
  }, [allJobs, search, filters, sort, tab, starred]);

  // Auto-select first on wide viewport
  useEffect(() => {
    if (view === 'cards') return;
    if (filtered.length && !filtered.find((j) => j.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
    if (!filtered.length) setSelectedId(null);
  }, [filtered, view]);

  const selectedJob = useMemo(
    () => filtered.find((j) => j.id === selectedId) ?? allJobs.find((j) => j.id === selectedId) ?? null,
    [filtered, allJobs, selectedId],
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        <div className="px-4 pt-2">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs -ml-1" onClick={() => navigate('/jobs')}>
            <ArrowLeft className="h-3.5 w-3.5" /> All sessions
          </Button>
        </div>
        {/* Header */}
        <JobsHeader
          candidateName={undefined}
          totalJobs={allJobs.length}
          filteredCount={filtered.length}
          search={search}
          onSearchChange={setSearch}
          sort={sort}
          onSortChange={setSort}
          view={view}
          onViewChange={setView}
          onRefresh={() => refetch()}
          refreshing={isRefetching}
          tab={tab}
          onTabChange={setTab}
          savedCount={starred.size}
          remoteCount={allJobs.filter((j) => j.remote_type === 'remote').length}
          sessionStatus={data?.session?.status}
        />

        {/* Body */}
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
        ) : (
          <div className={cn('flex flex-1 min-h-0 overflow-hidden', view === 'cards' && 'flex-col')}>
            {/* Filter rail */}
            <div className="w-52 shrink-0 overflow-hidden">
              <FilterRail
                filters={filters}
                setFilters={setFilters}
                jobs={allJobs}
                starredCount={starred.size}
              />
            </div>

            {/* List */}
            <div className={cn('flex-1 min-w-0 flex flex-col overflow-hidden border-r border-white/[0.06]', view === 'cards' && 'border-r-0')}>
              {view === 'split' ? (
                <>
                  {/* Column headers */}
                  <div
                    className="px-3 py-2 border-b border-white/[0.06] grid gap-3 text-[9.5px] font-mono uppercase tracking-widest text-muted-foreground/50"
                    style={{ gridTemplateColumns: '36px minmax(0,1.6fr) minmax(0,1fr) 100px 90px 72px 32px' }}
                  >
                    <span />
                    <span>Role · Company</span>
                    <span>Location</span>
                    <span>Mode</span>
                    <span>ATS</span>
                    <span>Posted</span>
                    <span />
                  </div>
                  <ScrollArea className="flex-1">
                    {filtered.length === 0 ? <EmptyState /> : filtered.map((j) => (
                      <JobRow
                        key={j.id}
                        job={j}
                        selected={selectedId === j.id}
                        starred={starred.has(j.id)}
                        onSelect={(job) => setSelectedId(job.id)}
                        onStar={() => toggleStar(j.id)}
                      />
                    ))}
                  </ScrollArea>
                </>
              ) : (
                <ScrollArea className="flex-1 p-4">
                  {filtered.length === 0 ? <EmptyState /> : (
                    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                      {filtered.map((j) => (
                        <JobCard
                          key={j.id}
                          job={j}
                          selected={selectedId === j.id}
                          starred={starred.has(j.id)}
                          onSelect={(job) => { setSelectedId(job.id); setView('split'); }}
                          onStar={() => toggleStar(j.id)}
                        />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              )}
            </div>

            {/* Detail panel — only in split mode */}
            {view === 'split' && (
              <div className="w-80 xl:w-96 shrink-0 overflow-hidden border-l border-white/[0.06]">
                <JobDetailPanel
                  job={selectedJob}
                  starred={selectedJob ? starred.has(selectedJob.id) : false}
                  onStar={() => selectedJob && toggleStar(selectedJob.id)}
                  onClose={() => setSelectedId(null)}
                  sessionId={sessionId ?? ''}
                  tailored={selectedJob ? tailored[selectedJob.id] : undefined}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
