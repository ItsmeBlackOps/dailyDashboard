/**
 * Global Jobs Tab — split-view listing of the shared `jobsPool` with
 * recruiter-scoped matching candidates and per-(job, candidate) apply
 * state.
 *
 * Visual structure ported from the standalone HTML mockup
 * (filter rail · row table · detail panel · cards toggle), wired to
 * /api/jobs/pool/list and /api/jobs/applications.
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, ExternalLink, MapPin, Star } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import FilterRail from '@/components/jobs/FilterRail';
import JobRow, { CompanyLogo } from '@/components/jobs/JobRow';
import JobDetailPanel from '@/components/jobs/JobDetailPanel';
import JobsHeader from '@/components/jobs/JobsHeader';
import type { Job, JobFilters, SortKey } from '@/components/jobs/types';
import { ATS_LABEL, relTime, shortLoc } from '@/utils/jobsFormatting';

interface MatchingCandidate {
  id: string;
  name: string;
  applied?: boolean;
  applicationStatus?: 'applied' | 'interview' | 'rejected' | 'hired' | null;
}
interface PoolJob {
  id: string;
  title: string;
  company: string;
  location: string | null;
  remote_type: 'remote' | 'hybrid' | 'onsite' | null;
  url: string;
  ats: string;
  postedAt: string | null;
  snippet: string;
  yearsOfExperience: number | null;
  experienceBucket: string | null;
  extractedTitles: string[];
  matchingCandidates: MatchingCandidate[];
  matchingCandidateCount: number;
}
interface PoolListResponse {
  success: boolean;
  total: number;
  jobs: PoolJob[];
}
interface CandidatesResponse {
  success: boolean;
  candidates: { id: string; name: string }[];
}

// ── starred (localStorage) ───────────────────────────────────────────
function useStarred() {
  const [starred, setStarred] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('dd_starred_jobs');
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch { return new Set(); }
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

// ── pool → Job adapter ───────────────────────────────────────────────
function adaptPoolJob(p: PoolJob): Job & { _pool: PoolJob } {
  return {
    id: p.id,
    title: p.title,
    company: p.company,
    location: p.location,
    remote_type: (p.remote_type ?? 'remote') as Job['remote_type'],
    ats: p.ats || '',
    url: p.url || '',
    date_posted: p.postedAt ?? new Date().toISOString(),
    snippet: p.snippet || '',
    _pool: p,
  };
}

// ── per-(job, candidate) match badge with apply chip ─────────────────
function MatchChip({
  candidate,
  jobId,
  onApply,
  busy,
}: {
  candidate: MatchingCandidate;
  jobId: string;
  onApply: (candidate: MatchingCandidate) => void;
  busy: boolean;
}) {
  const applied = !!candidate.applied;
  const status = candidate.applicationStatus;
  return (
    <span
      key={candidate.id}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] border transition-colors',
        applied
          ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5'
          : 'border-aurora-violet/40 text-aurora-violet'
      )}
      title={status ? `Status: ${status}` : 'Not applied'}
    >
      {candidate.name}
      <button
        type="button"
        disabled={busy}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); onApply(candidate); }}
        className={cn(
          'text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors',
          applied
            ? 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15'
            : 'border-white/15 text-muted-foreground hover:text-foreground hover:border-white/40',
          busy && 'opacity-50 cursor-not-allowed'
        )}
        aria-label={applied ? `Unapply ${candidate.name} for job ${jobId}` : `Apply ${candidate.name} for job ${jobId}`}
      >
        {applied ? '✓' : 'Apply'}
      </button>
    </span>
  );
}

// ── empty state ──────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
      <div className="w-16 h-16 rounded-full bg-aurora-violet/10 flex items-center justify-center mb-4">
        <Briefcase className="h-7 w-7 text-aurora-violet/60" />
      </div>
      <div className="font-semibold text-[15px] text-foreground/80 mb-1.5">No matching jobs</div>
      <div className="text-[12.5px] max-w-[300px] leading-relaxed">{message}</div>
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────
export default function JobsListPage() {
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [candidateId, setCandidateId] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [appliedFilter, setAppliedFilter] = useState<'all' | 'applied' | 'not-applied'>('all');
  const [filters, setFilters] = useState<JobFilters>({
    remote: [], ats: [], state: [], company: [], onlyStarred: false,
  });
  const [sort, setSort] = useState<SortKey>('date-desc');
  const [tab, setTab] = useState('all');
  const [view, setView] = useState<'split' | 'cards'>('split');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyApplyKey, setBusyApplyKey] = useState<string | null>(null);

  const [starred, toggleStar] = useStarred();

  // Active candidates for the dropdown.
  const { data: candList } = useQuery<CandidatesResponse>({
    queryKey: ['active-candidate-names'],
    queryFn: async () => {
      const res = await authFetch(`${API_URL}/api/candidates/active-names`);
      if (!res.ok) throw new Error('Failed to load candidates');
      return res.json();
    },
    staleTime: 60 * 1000,
  });
  const candidates = candList?.candidates ?? [];

  // Pool jobs (recruiter-scoped on the server).
  const poolKey = ['pool-jobs', candidateId, search] as const;
  const { data, isLoading, isRefetching, refetch } = useQuery<PoolListResponse>({
    queryKey: poolKey,
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '200', offset: '0' });
      if (candidateId !== 'all') params.set('candidateId', candidateId);
      if (search) params.set('q', search);
      const res = await authFetch(`${API_URL}/api/jobs/pool/list?${params}`);
      if (!res.ok) throw new Error('Failed to load jobs');
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Single-candidate applied set (only used when a candidate is picked).
  const { data: appliedData } = useQuery<{ appliedJobIds: string[] }>({
    queryKey: ['job-applications-set', candidateId],
    enabled: candidateId !== 'all',
    queryFn: async () => {
      const res = await authFetch(`${API_URL}/api/jobs/applications?candidateId=${candidateId}`);
      if (!res.ok) throw new Error('Failed to load applications');
      return res.json();
    },
    staleTime: 60 * 1000,
  });
  const appliedSet = useMemo(
    () => new Set(appliedData?.appliedJobIds ?? []),
    [appliedData]
  );

  // Adapt pool → Job and apply UI-side filters.
  const allJobs = useMemo(() => (data?.jobs ?? []).map(adaptPoolJob), [data]);

  const filtered = useMemo(() => {
    let result = allJobs;
    if (tab === 'saved') result = result.filter((j) => starred.has(j.id));
    if (tab === 'remote') result = result.filter((j) => j.remote_type === 'remote');
    if (filters.onlyStarred) result = result.filter((j) => starred.has(j.id));
    if (filters.remote.length) result = result.filter((j) => filters.remote.includes(j.remote_type));
    if (filters.ats.length) result = result.filter((j) => filters.ats.includes(j.ats));
    if (filters.company.length) result = result.filter((j) => filters.company.includes(j.company));
    if (filters.state.length) {
      result = result.filter((j) => {
        const st = shortLoc(j.location).split(',').slice(-1)[0].trim();
        return filters.state.includes(st);
      });
    }
    if (candidateId !== 'all' && appliedFilter !== 'all') {
      result = result.filter((j) =>
        appliedFilter === 'applied' ? appliedSet.has(j.id) : !appliedSet.has(j.id)
      );
    }
    const sorted = [...result];
    if (sort === 'date-desc') sorted.sort((a, b) => new Date(b.date_posted).getTime() - new Date(a.date_posted).getTime());
    if (sort === 'date-asc') sorted.sort((a, b) => new Date(a.date_posted).getTime() - new Date(b.date_posted).getTime());
    if (sort === 'company-asc') sorted.sort((a, b) => a.company.localeCompare(b.company));
    if (sort === 'title-asc') sorted.sort((a, b) => a.title.localeCompare(b.title));
    return sorted;
  }, [allJobs, search, filters, sort, tab, starred, candidateId, appliedFilter, appliedSet]);

  const selectedJob = useMemo(
    () => filtered.find((j) => j.id === selectedId) ?? allJobs.find((j) => j.id === selectedId) ?? null,
    [filtered, allJobs, selectedId]
  );

  // Per-(jobId, candidateId) toggle. Optimistic for snappy UX, then refetch
  // the list query to refresh authoritative apply states.
  const toggleApplyFor = useCallback(
    async (job: Job & { _pool: PoolJob }, candidate: MatchingCandidate) => {
      const key = `${job.id}|${candidate.id}`;
      setBusyApplyKey(key);
      const wasApplied = !!candidate.applied;
      // Optimistic mutate of the pool list cache.
      queryClient.setQueryData<PoolListResponse | undefined>(poolKey, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          jobs: prev.jobs.map((p) =>
            p.id !== job.id
              ? p
              : {
                  ...p,
                  matchingCandidates: p.matchingCandidates.map((m) =>
                    m.id !== candidate.id
                      ? m
                      : {
                          ...m,
                          applied: !wasApplied,
                          applicationStatus: wasApplied ? null : 'applied',
                        }
                  ),
                }
          ),
        };
      });
      try {
        if (wasApplied) {
          await authFetch(`${API_URL}/api/jobs/applications`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateId: candidate.id, jobId: job.id }),
          });
        } else {
          await authFetch(`${API_URL}/api/jobs/applications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              candidateId: candidate.id,
              jobId: job.id,
              jobTitle: job.title,
              company: job.company,
              jobUrl: job.url,
              status: 'applied',
            }),
          });
        }
        queryClient.invalidateQueries({ queryKey: ['pool-jobs'] });
        queryClient.invalidateQueries({ queryKey: ['job-applications-set'] });
      } catch (err) {
        queryClient.invalidateQueries({ queryKey: ['pool-jobs'] });
        toast({
          title: wasApplied ? 'Could not unmark application' : 'Could not mark applied',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
      } finally {
        setBusyApplyKey((k) => (k === key ? null : k));
      }
    },
    [authFetch, queryClient, toast, poolKey]
  );

  // Single-candidate (existing behavior) — Apply button on JobRow when one candidate is selected.
  const toggleAppliedSingle = useCallback(
    async (job: Job) => {
      if (candidateId === 'all') return;
      const wasApplied = appliedSet.has(job.id);
      queryClient.setQueryData<{ appliedJobIds: string[] }>(
        ['job-applications-set', candidateId],
        (prev) => {
          const cur = new Set(prev?.appliedJobIds ?? []);
          if (wasApplied) cur.delete(job.id); else cur.add(job.id);
          return { appliedJobIds: [...cur] };
        }
      );
      try {
        if (wasApplied) {
          await authFetch(`${API_URL}/api/jobs/applications`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateId, jobId: job.id }),
          });
        } else {
          await authFetch(`${API_URL}/api/jobs/applications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              candidateId,
              jobId: job.id,
              jobTitle: job.title,
              company: job.company,
              jobUrl: job.url,
              status: 'applied',
            }),
          });
        }
        queryClient.invalidateQueries({ queryKey: ['job-applications-set', candidateId] });
      } catch (err) {
        queryClient.invalidateQueries({ queryKey: ['job-applications-set', candidateId] });
        toast({
          title: 'Apply state failed',
          description: err instanceof Error ? err.message : String(err),
          variant: 'destructive',
        });
      }
    },
    [candidateId, appliedSet, authFetch, queryClient, toast]
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        {/* Sub-header: candidate selector + applied filter */}
        <div className="px-4 pt-3 pb-2 flex items-center gap-2 flex-wrap border-b border-white/[0.06]">
          <Briefcase className="h-4 w-4 text-aurora-violet" />
          <h1 className="text-[14px] font-semibold mr-2">Jobs</h1>
          <Select value={candidateId} onValueChange={setCandidateId}>
            <SelectTrigger className="w-[260px] text-sm h-8">
              <SelectValue placeholder="Filter by candidate" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All my candidates</SelectItem>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {candidateId !== 'all' && (
            <Select value={appliedFilter} onValueChange={(v) => setAppliedFilter(v as typeof appliedFilter)}>
              <SelectTrigger className="w-[160px] text-sm h-8">
                <SelectValue placeholder="Applied state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All jobs</SelectItem>
                <SelectItem value="not-applied">Not applied</SelectItem>
                <SelectItem value="applied">Applied</SelectItem>
              </SelectContent>
            </Select>
          )}
          {data && (
            <span className="text-[11px] text-muted-foreground ml-auto font-mono uppercase tracking-wider">
              {data.total} match{data.total === 1 ? '' : 'es'} · US only
            </span>
          )}
        </div>

        {/* Header (search · sort · tabs · view toggle) */}
        <JobsHeader
          candidateName={candidateId === 'all' ? undefined : candidates.find((c) => c.id === candidateId)?.name}
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
        />

        {/* Body */}
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
          </div>
        ) : (
          <div className={cn('flex flex-1 min-h-0 overflow-hidden', view === 'cards' && 'flex-col')}>
            <div className="w-52 shrink-0 overflow-hidden">
              <FilterRail
                filters={filters}
                setFilters={setFilters}
                jobs={allJobs}
                starredCount={starred.size}
              />
            </div>

            <div className={cn('flex-1 min-w-0 flex flex-col overflow-hidden border-r border-white/[0.06]', view === 'cards' && 'border-r-0')}>
              {view === 'split' ? (
                <>
                  <div
                    className="px-3 py-2 border-b border-white/[0.06] grid gap-3 text-[9.5px] font-mono uppercase tracking-widest text-muted-foreground/50"
                    style={{ gridTemplateColumns: '36px minmax(0,1.6fr) minmax(0,1fr) 100px 90px 72px 70px 32px' }}
                  >
                    <span />
                    <span>Role · Company</span>
                    <span>Location</span>
                    <span>Mode</span>
                    <span>ATS</span>
                    <span>Posted</span>
                    <span>Apply</span>
                    <span />
                  </div>
                  <ScrollArea className="flex-1">
                    {filtered.length === 0 ? (
                      <EmptyState
                        message={
                          candidateId === 'all'
                            ? 'No jobs in your hierarchy match these filters yet.'
                            : 'No pool jobs match this candidate.'
                        }
                      />
                    ) : (
                      filtered.map((j) => {
                        const pool = j._pool;
                        return (
                          <div key={j.id}>
                            <JobRow
                              job={j}
                              selected={selectedId === j.id}
                              starred={starred.has(j.id)}
                              applied={candidateId !== 'all' ? appliedSet.has(j.id) : undefined}
                              onSelect={(job) => setSelectedId(job.id)}
                              onStar={() => toggleStar(j.id)}
                              onToggleApplied={candidateId !== 'all' ? () => toggleAppliedSingle(j) : undefined}
                            />
                            {/* Per-candidate apply chips (only when "all candidates"
                                view, where a single Apply chip on the row is meaningless). */}
                            {candidateId === 'all' && pool.matchingCandidates.length > 0 && (
                              <div className="px-3 pb-2.5 -mt-1 flex flex-wrap items-center gap-1.5">
                                <span className="text-[10px] text-muted-foreground/70 mr-1">Matches:</span>
                                {pool.matchingCandidates.map((c) => (
                                  <MatchChip
                                    key={c.id}
                                    candidate={c}
                                    jobId={j.id}
                                    busy={busyApplyKey === `${j.id}|${c.id}`}
                                    onApply={(cand) => toggleApplyFor(j, cand)}
                                  />
                                ))}
                                {pool.matchingCandidateCount > pool.matchingCandidates.length && (
                                  <span className="text-[10px] text-muted-foreground">
                                    +{pool.matchingCandidateCount - pool.matchingCandidates.length} more
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </ScrollArea>
                </>
              ) : (
                <ScrollArea className="flex-1 p-4">
                  {filtered.length === 0 ? (
                    <EmptyState message="No jobs match these filters." />
                  ) : (
                    <div
                      className="grid gap-3"
                      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
                    >
                      {filtered.map((j) => {
                        const pool = j._pool;
                        return (
                          <div
                            key={j.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => { setSelectedId(j.id); setView('split'); }}
                            className={cn(
                              'rounded-xl border bg-card p-4 cursor-pointer transition-colors hover:border-aurora-violet/30',
                              selectedId === j.id && 'border-aurora-violet/50 bg-aurora-violet/5'
                            )}
                          >
                            <div className="flex items-start gap-3 mb-3">
                              <CompanyLogo company={j.company} size={40} />
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-[14.5px] leading-tight line-clamp-2">{j.title}</div>
                                <div className="text-[12px] text-muted-foreground mt-0.5">{j.company}</div>
                              </div>
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleStar(j.id); }}
                                className={cn('shrink-0 mt-0.5', starred.has(j.id) ? 'text-amber-400' : 'text-muted-foreground/40')}
                              >
                                <Star className={cn('h-4 w-4', starred.has(j.id) && 'fill-amber-400')} />
                              </button>
                            </div>
                            <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground mb-3">
                              <MapPin className="h-3 w-3 opacity-50" />
                              <span>{shortLoc(j.location)}</span>
                              <span className="w-1 h-1 rounded-full bg-muted-foreground/30" />
                              <span className="font-mono">{relTime(new Date(j.date_posted))}</span>
                            </div>
                            {j.snippet && (
                              <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-3 mb-3">
                                {j.snippet}
                              </p>
                            )}
                            {pool.matchingCandidates.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5 mb-3">
                                {pool.matchingCandidates.slice(0, 3).map((c) => (
                                  <MatchChip
                                    key={c.id}
                                    candidate={c}
                                    jobId={j.id}
                                    busy={busyApplyKey === `${j.id}|${c.id}`}
                                    onApply={(cand) => toggleApplyFor(j, cand)}
                                  />
                                ))}
                                {pool.matchingCandidateCount > 3 && (
                                  <span className="text-[10px] text-muted-foreground">
                                    +{pool.matchingCandidateCount - 3} more
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="flex items-center justify-between border-t border-white/[0.06] pt-3">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] bg-white/[0.06] border border-white/10 text-foreground/70">
                                via {ATS_LABEL[j.ats] ?? j.ats}
                              </span>
                              <a
                                href={j.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-[11px] text-aurora-violet hover:text-aurora-violet/80"
                              >
                                Open <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              )}
            </div>

            {view === 'split' && (
              <div className="w-80 xl:w-96 shrink-0 overflow-hidden border-l border-white/[0.06]">
                <JobDetailPanel
                  job={selectedJob}
                  starred={selectedJob ? starred.has(selectedJob.id) : false}
                  onStar={() => selectedJob && toggleStar(selectedJob.id)}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
