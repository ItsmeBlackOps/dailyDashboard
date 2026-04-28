import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Briefcase } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAuth, API_URL } from '@/hooks/useAuth';
import type { JobSession } from '@/components/jobs/types';

function formatDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
}

const STATUS_CLASS: Record<string, string> = {
  running: 'bg-aurora-cyan/10 text-aurora-cyan border-aurora-cyan/30',
  complete: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  error: 'bg-destructive/10 text-destructive border-destructive/30',
};

export default function CandidateJobsListPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const navigate = useNavigate();
  const { authFetch } = useAuth();

  const { data, isLoading } = useQuery<{ success: boolean; sessions: JobSession[] }>({
    queryKey: ['job-sessions', candidateId],
    queryFn: async () => {
      const res = await authFetch(`${API_URL}/api/jobs/sessions?candidateId=${candidateId}`);
      if (!res.ok) throw new Error('Failed to load sessions');
      return res.json();
    },
    enabled: !!candidateId,
  });

  const sessions = data?.sessions ?? [];

  return (
    <DashboardLayout>
      <div className="px-4 md:px-6 py-4 space-y-5 max-w-3xl mx-auto">
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs -ml-1" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>

        <div className="flex items-center gap-3">
          <Briefcase className="h-5 w-5 text-aurora-violet" />
          <h1 className="text-lg font-bold">Job Search Sessions</h1>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        )}

        {!isLoading && sessions.length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm">
            No job search sessions yet. Use "Find Jobs" on the candidate profile to start one.
          </div>
        )}

        {sessions.map((s) => (
          <div
            key={s.sessionId}
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/jobs/${s.sessionId}`)}
            onKeyDown={(e) => e.key === 'Enter' && navigate(`/jobs/${s.sessionId}`)}
            className="flex items-center gap-4 p-4 rounded-xl border bg-card hover:border-aurora-violet/30 cursor-pointer transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-foreground truncate">
                Session — {formatDate(s.createdAt)}
              </div>
              <div className="text-[11.5px] text-muted-foreground mt-0.5">
                {s.totalFound != null ? `${s.totalFound} results` : 'In progress…'}
                {s.completedAt && ` · Completed ${formatDate(s.completedAt)}`}
              </div>
            </div>
            <Badge
              variant="outline"
              className={STATUS_CLASS[s.status] ?? 'border-border text-muted-foreground'}
            >
              {s.status}
            </Badge>
          </div>
        ))}
      </div>
    </DashboardLayout>
  );
}
