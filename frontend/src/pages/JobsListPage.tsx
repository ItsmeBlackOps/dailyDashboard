import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Briefcase, Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  pending: 'bg-aurora-cyan/10 text-aurora-cyan border-aurora-cyan/30',
  complete: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  error: 'bg-destructive/10 text-destructive border-destructive/30',
};

export default function JobsListPage() {
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const candidateId = localStorage.getItem('candidateId') ?? undefined;
  const [showFailed, setShowFailed] = useState(false);

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
    refetchInterval: (q) => {
      const sessions = q.state.data?.sessions ?? [];
      const inFlight = sessions.some((s) => s.status === 'pending' || s.status === 'running');
      return inFlight ? 4000 : false;
    },
  });

  const allSessions = data?.sessions ?? [];
  const failedCount = useMemo(
    () => allSessions.filter((s) => s.status === 'error').length,
    [allSessions]
  );
  const visibleSessions = useMemo(
    () => (showFailed ? allSessions : allSessions.filter((s) => s.status !== 'error')),
    [allSessions, showFailed]
  );

  // Most-recent successful session for the "Open latest" deep-link.
  const latestComplete = useMemo(
    () => allSessions.find((s) => s.status === 'complete'),
    [allSessions]
  );

  return (
    <DashboardLayout>
      <div className="px-4 md:px-6 py-6 space-y-5 max-w-3xl mx-auto">
        <div className="flex items-center gap-3 flex-wrap">
          <Briefcase className="h-5 w-5 text-aurora-violet" />
          <h1 className="text-lg font-bold">Recent Job Searches</h1>
          {latestComplete && (
            <Button
              size="sm"
              className="ml-auto bg-gradient-to-r from-aurora-violet to-aurora-cyan text-white"
              onClick={() => navigate(`/jobs/${latestComplete.sessionId}`)}
            >
              Open latest results
            </Button>
          )}
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        )}

        {!isLoading && allSessions.length === 0 && (
          <EmptyState
            icon={<Briefcase className="h-6 w-6" />}
            title="No job searches yet"
            description="Auto-search runs on container startup and twice a day for every active candidate. New sessions will appear here within a few minutes."
          />
        )}

        {/* All sessions exist but every one of them failed → tell the
            user explicitly instead of just an empty list. */}
        {!isLoading && allSessions.length > 0 && visibleSessions.length === 0 && !showFailed && (
          <EmptyState
            icon={<Briefcase className="h-6 w-6" />}
            title="No completed searches yet"
            description={`The most recent ${failedCount} search${failedCount === 1 ? '' : 'es'} failed. The team has been notified — new auto-search runs are scheduled twice a day.`}
            action={
              <Button variant="outline" size="sm" onClick={() => setShowFailed(true)}>
                Show failed searches
              </Button>
            }
          />
        )}

        {visibleSessions.map((s) => (
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
                {s.totalFound != null
                  ? `${s.totalFound} results`
                  : s.status === 'error'
                    ? 'Failed'
                    : 'In progress…'}
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
                <Loader2 className="h-3 w-3 mr-1 animate-spin inline-block" aria-hidden />
              )}
              {s.status}
            </Badge>
          </div>
        ))}

        {/* Toggle to reveal failed sessions when the default view is hiding them. */}
        {!isLoading && failedCount > 0 && visibleSessions.length > 0 && (
          <div className="pt-2 text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowFailed((v) => !v)}
              className="text-xs text-muted-foreground"
            >
              {showFailed
                ? `Hide ${failedCount} failed search${failedCount === 1 ? '' : 'es'}`
                : `Show ${failedCount} failed search${failedCount === 1 ? '' : 'es'}`}
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
