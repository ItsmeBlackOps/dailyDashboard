import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAuth, API_URL } from '@/hooks/useAuth';
import type { JobSession } from '@/components/jobs/types';

function formatDate(s?: string | null) {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
}

const STATUS_CLASS: Record<string, string> = {
  running: 'bg-aurora-cyan/10 text-aurora-cyan border-aurora-cyan/30',
  complete: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  error: 'bg-destructive/10 text-destructive border-destructive/30',
};

export default function JobsListPage() {
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const candidateId = localStorage.getItem('candidateId') ?? undefined;

  const { data, isLoading } = useQuery<{ success: boolean; sessions: JobSession[] }>({
    queryKey: ['job-sessions-all'],
    queryFn: async () => {
      const url = candidateId
        ? `${API_URL}/api/jobs/sessions?candidateId=${candidateId}`
        : `${API_URL}/api/jobs/sessions`;
      const res = await authFetch(url);
      if (!res.ok) throw new Error('Failed to load sessions');
      return res.json();
    },
    // Poll while any session is still pending/running so the UI updates
    // without a manual refresh. Stops once everything is terminal.
    refetchInterval: (q) => {
      const sessions = q.state.data?.sessions ?? [];
      const inFlight = sessions.some((s) => s.status === 'pending' || s.status === 'running');
      return inFlight ? 4000 : false;
    },
  });

  const sessions = data?.sessions ?? [];

  return (
    <DashboardLayout>
      <div className="px-4 md:px-6 py-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-3">
          <Briefcase className="h-5 w-5 text-aurora-violet" />
          <h1 className="text-lg font-bold">Recent Job Searches</h1>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        )}

        {!isLoading && sessions.length === 0 && (
          <EmptyState
            icon={<Briefcase className="h-6 w-6" />}
            title="No job searches yet"
            description='Open a candidate profile and click "Find Jobs" to start one. Results will appear here.'
          />
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
                Session — {formatDate(s.requestedAt ?? s.createdAt)}
              </div>
              <div className="text-[11.5px] text-muted-foreground mt-0.5">
                {s.totalFound != null ? `${s.totalFound} results` : s.status === 'error' ? 'Failed' : 'In progress…'}
                {s.completedAt && ` · Completed ${formatDate(s.completedAt)}`}
              </div>
              {s.status === 'error' && s.error && (
                <div className="text-[11px] text-destructive mt-1 line-clamp-2" title={s.error}>
                  {s.error}
                </div>
              )}
            </div>
            <Badge
              variant="outline"
              className={STATUS_CLASS[s.status] ?? 'border-border text-muted-foreground'}
            >
              {(s.status === 'running' || s.status === 'pending') && (
                <Loader2 className="h-3 w-3 mr-1 animate-spin inline-block" />
              )}
              {s.status}
            </Badge>
          </div>
        ))}
      </div>
    </DashboardLayout>
  );
}
