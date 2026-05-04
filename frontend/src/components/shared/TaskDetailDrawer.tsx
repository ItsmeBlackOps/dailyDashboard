import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseJsonOrThrow } from '@/lib/fetchJson';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Calendar, Clock, Building2, Briefcase, User, Mail,
  ExternalLink, Loader2, Layers, Users,
} from 'lucide-react';
import { useAuth, API_URL } from '@/hooks/useAuth';

interface TaskDetail {
  taskId: string;
  candidateId: string | null;
  candidateName: string;
  emailId: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  role: string;
  client: string;
  round: string;
  actualRound: string;
  status: string;
  vendor: string;
  recruiter: string;
  assignedTo: string;
  assignedAt: string | null;
  suggestions: string[];
  receivedAt: string | null;
}

interface Props {
  taskId: string | null;
  /** Optionally pass partial data to show immediately while loading */
  preload?: Partial<TaskDetail>;
  onClose: () => void;
}

const STATUS_VARIANT: Record<string, string> = {
  completed:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  done:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  selected:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled:   'bg-red-50 text-red-700 border-red-200',
  rescheduled: 'bg-amber-50 text-amber-700 border-amber-200',
  pending:     'bg-sky-50 text-sky-700 border-sky-200',
};

function statusClass(status: string) {
  return STATUS_VARIANT[(status || '').toLowerCase()] ?? 'bg-muted text-foreground border-border';
}

function formatEmail(email: string) {
  if (!email) return '';
  if (!email.includes('@')) return email;
  return email.split('@')[0].split(/[._]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

function formatDate(d: string | null) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Field({ icon: Icon, label, value, className }: {
  icon: React.ElementType; label: string; value?: string | null; className?: string;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
      <div className={className}>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-xs font-medium">{value}</div>
      </div>
    </div>
  );
}

export function TaskDetailDrawer({ taskId, preload, onClose }: Props) {
  const { authFetch } = useAuth();
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!taskId) { setTask(null); return; }
    setLoading(true);
    authFetch(`${API_URL}/api/candidates/task/${taskId}`)
      .then(parseJsonOrThrow)
      .then((json: { success: boolean; task: typeof task }) => {
        if (json.success) setTask(json.task);
      })
      .catch((err) => {
        // Helper has already logged status + body snippet to console.
        // Drawer keeps preload visible — no toast spam for transient
        // backend hiccups.
        console.warn('TaskDetailDrawer load failed', err);
      })
      .finally(() => setLoading(false));
  }, [taskId, authFetch]);

  const display = task ?? (preload as TaskDetail | null);

  return (
    <Dialog open={!!taskId} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base leading-tight">
            {loading && !display ? 'Loading…' : (display?.candidateName || 'Task Details')}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {display?.emailId && <span className="text-muted-foreground">{display.emailId}</span>}
          </DialogDescription>
        </DialogHeader>

        {loading && !display && (
          <div className="space-y-3 py-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded" />
            ))}
          </div>
        )}

        {loading && display && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading full details…
          </div>
        )}

        {display && (
          <div className="space-y-4 pt-1">
            {/* Status + date row */}
            <div className="flex flex-wrap items-center gap-2">
              {display.status && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${statusClass(display.status)}`}>
                  {display.status}
                </span>
              )}
              {display.date && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {display.date}
                </span>
              )}
              {(display.startTime || display.endTime) && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {[display.startTime, display.endTime].filter(Boolean).join(' – ')}
                </span>
              )}
            </div>

            <Separator />

            {/* Core fields grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field icon={Building2} label="Client"       value={display.client} />
              <Field icon={Briefcase} label="Job Title"    value={display.role} />
              <Field icon={Layers}    label="Round"        value={display.round} />
              <Field icon={Layers}    label="Actual Round" value={display.actualRound} />
              <Field icon={Building2} label="Vendor"       value={display.vendor} />
              {display.recruiter && (
                <Field icon={Mail}   label="Recruiter"
                  value={display.recruiter.includes('@') ? formatEmail(display.recruiter) : display.recruiter} />
              )}
              {display.assignedTo && (
                <Field icon={User}   label="Expert"
                  value={display.assignedTo.includes('@') ? formatEmail(display.assignedTo) : display.assignedTo} />
              )}
              {display.assignedAt && (
                <Field icon={Clock}  label="Assigned At"  value={formatDate(display.assignedAt) ?? undefined} />
              )}
              {display.receivedAt && (
                <Field icon={Calendar} label="Received"   value={formatDate(display.receivedAt) ?? undefined} />
              )}
            </div>

            {/* Expert suggestions */}
            {display.suggestions && display.suggestions.length > 0 && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Expert Suggestions</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {display.suggestions.map((s, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px] px-1.5">{s}</Badge>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Footer action */}
            <Separator />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5 flex-1"
                onClick={() => { onClose(); navigate(`/task/${taskId}`); }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View Full Task
              </Button>
              {display.candidateId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1.5 flex-1"
                  onClick={() => { onClose(); navigate(`/candidate/${display.candidateId}`); }}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Candidate Profile
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
