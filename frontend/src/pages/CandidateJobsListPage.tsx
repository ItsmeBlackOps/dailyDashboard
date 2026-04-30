import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Briefcase, ExternalLink, MapPin } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { CompanyLogo } from '@/components/jobs/JobRow';
import { shortLoc, relTime, ATS_LABEL } from '@/utils/jobsFormatting';

interface MatchedJob {
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
}

interface MatchResponse {
  success: boolean;
  candidateId: string;
  candidateName: string;
  forgeProfile: { titles: string[]; years_min: number | null; years_max: number | null };
  candidateBuckets: string[];
  total: number;
  jobs: MatchedJob[];
  message?: string;
}

export default function CandidateJobsListPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const navigate = useNavigate();
  const { authFetch } = useAuth();

  const { data, isLoading, error } = useQuery<MatchResponse>({
    queryKey: ['matched-jobs', candidateId],
    enabled: !!candidateId,
    queryFn: async () => {
      const res = await authFetch(`${API_URL}/api/jobs/matched/${candidateId}?limit=200`);
      if (!res.ok) throw new Error('Failed to load matched jobs');
      return res.json();
    },
    // Pool changes hourly at most — no need to refetch on focus / reconnect.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const jobs = data?.jobs ?? [];
  const fp = data?.forgeProfile;

  return (
    <DashboardLayout>
      <div className="px-4 md:px-6 py-4 space-y-5 max-w-4xl mx-auto">
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs -ml-1" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>

        <div className="flex items-start gap-3 flex-wrap">
          <Briefcase className="h-5 w-5 text-aurora-violet mt-0.5" />
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold">Matched Jobs</h1>
            {data?.candidateName && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {data.candidateName}
                {fp?.years_max != null && ` · ${fp.years_min ?? 0}-${fp.years_max} yrs`}
                {data.total > 0 && ` · ${data.total} match${data.total === 1 ? '' : 'es'}`}
              </p>
            )}
            {fp?.titles && fp.titles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {fp.titles.slice(0, 6).map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        )}

        {error && (
          <EmptyState
            icon={<Briefcase className="h-6 w-6" />}
            title="Could not load jobs"
            description={error instanceof Error ? error.message : 'Unknown error'}
          />
        )}

        {!isLoading && !error && jobs.length === 0 && (
          <EmptyState
            icon={<Briefcase className="h-6 w-6" />}
            title="No matched jobs yet"
            description={
              data?.message
              ?? 'Once the daily Apify import runs and the candidate has a derived forgeProfile, matching jobs appear here.'
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
              {j.snippet && (
                <p className="text-[11.5px] text-muted-foreground line-clamp-2 mt-2 leading-relaxed">{j.snippet}</p>
              )}
            </div>
          </a>
        ))}
      </div>
    </DashboardLayout>
  );
}
