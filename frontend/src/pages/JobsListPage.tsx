import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Briefcase, ExternalLink, MapPin, Search, X } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { CompanyLogo } from '@/components/jobs/JobRow';
import { shortLoc, relTime, ATS_LABEL } from '@/utils/jobsFormatting';

interface MatchingCandidate {
  id: string;
  name: string;
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
  limit: number;
  offset: number;
  candidateId: string | null;
  candidateName: string | null;
  jobs: PoolJob[];
}

interface CandidatesResponse {
  success: boolean;
  candidates: { id: string; name: string }[];
}

export default function JobsListPage() {
  const { authFetch } = useAuth();
  const [candidateId, setCandidateId] = useState<string>('all');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');

  // Active candidates for the filter dropdown — lightweight {id,name}[]
  // endpoint avoids pulling the full /grouped payload just to populate
  // a <select>.
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

  const { data, isLoading } = useQuery<PoolListResponse>({
    queryKey: ['pool-jobs', candidateId, search],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '100', offset: '0' });
      if (candidateId !== 'all') params.set('candidateId', candidateId);
      if (search) params.set('q', search);
      const res = await authFetch(`${API_URL}/api/jobs/pool/list?${params}`);
      if (!res.ok) throw new Error('Failed to load jobs');
      return res.json();
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const jobs = data?.jobs ?? [];
  const candidateLabel = useMemo(() => {
    if (candidateId === 'all') return 'All candidates';
    return candidates.find((c) => c.id === candidateId)?.name ?? candidateId;
  }, [candidateId, candidates]);

  return (
    <DashboardLayout>
      <div className="px-4 md:px-6 py-6 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 flex-wrap">
          <Briefcase className="h-5 w-5 text-aurora-violet" />
          <h1 className="text-lg font-bold">Jobs</h1>
          {data && (
            <span className="text-xs text-muted-foreground">
              {data.total} match{data.total === 1 ? '' : 'es'} · {candidateLabel} · US only
            </span>
          )}
        </div>

        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <Select value={candidateId} onValueChange={setCandidateId}>
            <SelectTrigger className="w-full md:w-[280px] text-sm">
              <SelectValue placeholder="Filter by candidate" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All candidates</SelectItem>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1.5 flex-1">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              placeholder="Search title or company…"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setSearch(searchDraft.trim())}
              className="text-sm"
            />
            {search && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => { setSearch(''); setSearchDraft(''); }}
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
            <Button size="sm" onClick={() => setSearch(searchDraft.trim())}>
              Search
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        )}

        {!isLoading && jobs.length === 0 && (
          <EmptyState
            icon={<Briefcase className="h-6 w-6" />}
            title="No matching jobs in the pool"
            description={
              candidateId === 'all'
                ? 'The Apify import has not landed any jobs that match active candidates yet.'
                : `No pool jobs match ${candidateLabel}'s forgeProfile titles + YoE bucket.`
            }
          />
        )}

        {jobs.map((j) => (
          <a
            key={j.id}
            href={j.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-3 p-4 rounded-xl border bg-card hover:border-aurora-violet/30 transition-colors block"
          >
            <CompanyLogo company={j.company} size={40} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-semibold truncate">{j.title}</p>
                {j.postedAt && (
                  <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                    {relTime(new Date(j.postedAt))}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{j.company}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[10.5px] text-muted-foreground">
                {j.location && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3 opacity-50" /> {shortLoc(j.location)}
                  </span>
                )}
                {j.remote_type && (
                  <Badge variant="outline" className="text-[10px] capitalize">{j.remote_type}</Badge>
                )}
                {j.experienceBucket && (
                  <Badge variant="outline" className="text-[10px]">{j.experienceBucket} yrs</Badge>
                )}
                {j.ats && <span>via {ATS_LABEL[j.ats] ?? j.ats}</span>}
                <ExternalLink className="h-3 w-3 ml-auto opacity-60" />
              </div>

              {/* Matching-candidate badges */}
              {j.matchingCandidateCount > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-[10px] text-muted-foreground mr-1">Matches:</span>
                  {j.matchingCandidates.map((c) => (
                    <Badge
                      key={c.id}
                      variant="outline"
                      className="text-[10px] border-aurora-violet/40 text-aurora-violet"
                    >
                      {c.name}
                    </Badge>
                  ))}
                  {j.matchingCandidateCount > j.matchingCandidates.length && (
                    <Badge variant="outline" className="text-[10px]">
                      +{j.matchingCandidateCount - j.matchingCandidates.length} more
                    </Badge>
                  )}
                </div>
              )}

              {j.snippet && (
                <p className="text-[11.5px] text-muted-foreground line-clamp-2 mt-2 leading-relaxed">
                  {j.snippet}
                </p>
              )}
            </div>
          </a>
        ))}
      </div>
    </DashboardLayout>
  );
}
