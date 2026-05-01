import { ExternalLink, MapPin, Clock, Star, X, Download, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { shortLoc, relTime, ATS_LABEL } from '@/utils/jobsFormatting';
import { CompanyLogo } from './JobRow';
import type { Job, TailoredStatus } from './types';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

const REMOTE_CLASS: Record<string, string> = {
  remote: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  hybrid: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30',
  onsite: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
};

interface JobDetailPanelProps {
  job: Job | null;
  starred: boolean;
  onStar: () => void;
  onClose: () => void;
  /** Optional — when omitted (e.g. global Jobs Tab) tailor-resume CTA is hidden. */
  sessionId?: string;
  tailored?: TailoredStatus;
}

export default function JobDetailPanel({
  job,
  starred,
  onStar,
  onClose,
  sessionId,
  tailored,
}: JobDetailPanelProps) {
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const tailorMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await authFetch(`${API_URL}/api/jobs/sessions/${sessionId}/tailor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to start tailor' }));
        throw new Error(err.error || 'Failed to start tailor');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Tailoring resume…', description: 'You\'ll be notified when it\'s ready.' });
      queryClient.invalidateQueries({ queryKey: ['job-session', sessionId] });
    },
    onError: (err: Error) => {
      toast({ title: 'Tailor failed', description: err.message, variant: 'destructive' });
    },
  });

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 text-muted-foreground">
        <div className="w-16 h-16 rounded-full bg-aurora-violet/10 flex items-center justify-center mb-4">
          <Star className="h-7 w-7 text-aurora-violet/60" />
        </div>
        <div className="font-semibold text-[15px] text-foreground/80 mb-1.5">Select a job to preview</div>
        <div className="text-[12.5px] max-w-[220px] leading-relaxed">
          Click any row — full posting, ATS link, and tailor resume open here.
        </div>
      </div>
    );
  }

  const postedDate = new Date(job.date_posted);
  const tailorStatus = tailored?.status;

  return (
    <div key={job.id} className="flex flex-col h-full overflow-y-auto">
      {/* Hero */}
      <div className="relative p-5 pb-4 border-b border-white/[0.06] bg-gradient-to-b from-aurora-violet/10 to-transparent">
        <div className="absolute top-3 right-3 flex gap-1.5">
          <button
            aria-label={starred ? 'Remove bookmark' : 'Bookmark'}
            onClick={onStar}
            className={cn(
              'flex items-center justify-center w-7 h-7 rounded transition-colors hover:bg-white/10',
              starred ? 'text-amber-400' : 'text-muted-foreground/50',
            )}
          >
            <Star className={cn('h-4 w-4', starred && 'fill-amber-400')} />
          </button>
          <button
            aria-label="Close"
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded transition-colors hover:bg-white/10 text-muted-foreground/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-start gap-3.5 mb-3.5 pr-16">
          <CompanyLogo company={job.company} size={52} />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-muted-foreground mb-1">{job.company}</div>
            <h2 className="text-[20px] font-bold leading-snug text-foreground">{job.title}</h2>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium border capitalize',
              REMOTE_CLASS[job.remote_type] ?? 'bg-muted/40 text-muted-foreground border-border',
            )}
          >
            {job.remote_type}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-white/[0.06] border border-white/10 text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {shortLoc(job.location)}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-white/[0.06] border border-white/10 text-muted-foreground">
            <Clock className="h-3 w-3" />
            {relTime(postedDate)}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-white/[0.06] border border-white/10 text-foreground/70">
            {ATS_LABEL[job.ats] ?? job.ats}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 p-4 border-b border-white/[0.06]">
        <Button
          asChild
          className="flex-1 bg-gradient-to-r from-aurora-violet to-aurora-cyan text-white hover:opacity-90 gap-1.5"
          size="sm"
        >
          <a href={job.url} target="_blank" rel="noopener noreferrer">
            Apply on {ATS_LABEL[job.ats] ?? job.ats}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>

        {/* Tailor Resume button — only when a sessionId is available (per-session
            page). Global Jobs Tab has no session context, so the CTA is hidden. */}
        {!sessionId ? null : tailorStatus === 'complete' && tailored?.tailoredResumeUrl ? (
          <Button variant="outline" size="sm" asChild className="gap-1.5 text-emerald-400 border-emerald-500/40">
            <a href={tailored.tailoredResumeUrl} target="_blank" rel="noopener noreferrer">
              <Download className="h-3.5 w-3.5" /> Tailored Resume
            </a>
          </Button>
        ) : tailorStatus === 'running' || tailorStatus === 'pending' ? (
          <Button variant="outline" size="sm" disabled className="gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Tailoring…
          </Button>
        ) : tailorStatus === 'error' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => tailorMutation.mutate(job.id)}
            className="gap-1.5 text-destructive border-destructive/40"
          >
            <AlertCircle className="h-3.5 w-3.5" /> Retry Tailor
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => tailorMutation.mutate(job.id)}
            disabled={tailorMutation.isPending}
            className="gap-1.5"
          >
            {tailorMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Tailor Resume
          </Button>
        )}
      </div>

      {/* Snippet */}
      <div className="p-4 border-b border-white/[0.06]">
        <div className="text-[9.5px] font-mono uppercase tracking-widest text-muted-foreground/60 font-semibold mb-2.5">
          About this role
        </div>
        <p className="text-[13px] leading-relaxed text-foreground/85">{job.snippet}</p>
      </div>

      {/* Skills */}
      {job.skills && job.skills.length > 0 && (
        <div className="p-4 border-b border-white/[0.06]">
          <div className="text-[9.5px] font-mono uppercase tracking-widest text-muted-foreground/60 font-semibold mb-2.5">
            Skills
          </div>
          <div className="flex flex-wrap gap-1.5">
            {job.skills.map((s) => (
              <Badge key={s} variant="secondary" className="text-[11px] bg-aurora-violet/10 text-aurora-violet border border-aurora-violet/20">
                {s}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="p-4 border-b border-white/[0.06]">
        <div className="text-[9.5px] font-mono uppercase tracking-widest text-muted-foreground/60 font-semibold mb-2.5">
          Posting metadata
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12px]">
          {[
            ['Posted', postedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })],
            ['Company', job.company],
            ['Location', job.location ?? '—'],
            ['Work mode', job.remote_type],
            ['Source ATS', ATS_LABEL[job.ats] ?? job.ats],
          ].map(([k, v]) => (
            <>
              <dt key={`k-${k}`} className="text-muted-foreground">{k}</dt>
              <dd key={`v-${k}`} className="text-foreground capitalize">{v}</dd>
            </>
          ))}
        </dl>
      </div>

      {/* URL */}
      <div className="p-4">
        <div className="text-[9.5px] font-mono uppercase tracking-widest text-muted-foreground/60 font-semibold mb-2.5">
          Source URL
        </div>
        <a
          href={job.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block font-mono text-[11px] text-aurora-cyan/80 hover:text-aurora-cyan break-all leading-relaxed p-2.5 rounded-lg bg-aurora-cyan/5 border border-aurora-cyan/15 transition-colors"
        >
          {job.url}
        </a>
      </div>
    </div>
  );
}
