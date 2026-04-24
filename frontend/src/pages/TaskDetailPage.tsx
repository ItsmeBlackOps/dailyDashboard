import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Calendar, Clock, Building2, Briefcase, User, Mail,
  Layers, Users, ExternalLink, MessageSquare, FileText,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useAuth, API_URL } from '@/hooks/useAuth';

// ── Types ─────────────────────────────────────────────────────────────────────
interface TaskReply {
  body: string;
  from: string;
  receivedAt: string | null;
}

interface TaskFull {
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
  body: string;
  replies: TaskReply[];
  subject: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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

function formatDateTime(d: string | null) {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

const STATUS_CLASS: Record<string, string> = {
  completed:   'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  done:        'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  selected:    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  cancelled:   'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300',
  rescheduled: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
};

function statusClass(s: string) {
  return STATUS_CLASS[(s || '').toLowerCase()] ?? 'bg-muted text-foreground border-border';
}

// ── Field component ───────────────────────────────────────────────────────────
function Field({ icon: Icon, label, value }: {
  icon: React.ElementType; label: string; value?: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-xs font-medium">{value}</div>
      </div>
    </div>
  );
}

// ── Email body renderer ───────────────────────────────────────────────────────
function EmailBody({ text }: { text: string }) {
  if (!text) return null;
  // Strip excess blank lines, render as preformatted but wrapped
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return (
    <pre className="text-xs text-foreground/80 whitespace-pre-wrap break-words font-sans leading-relaxed">
      {cleaned}
    </pre>
  );
}

// ── Reply bubble ─────────────────────────────────────────────────────────────
function ReplyBubble({ reply, index }: { reply: TaskReply; index: number }) {
  const isFirst = index === 0;
  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div className="shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold mt-0.5">
        {reply.from ? (reply.from.charAt(0).toUpperCase()) : '?'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-xs font-semibold">
            {reply.from
              ? (reply.from.includes('@') ? formatEmail(reply.from) : reply.from)
              : 'Unknown'}
          </span>
          {isFirst && <Badge variant="secondary" className="text-[9px] px-1">Original</Badge>}
          {reply.receivedAt && (
            <span className="text-[10px] text-muted-foreground ml-auto">{formatDateTime(reply.receivedAt)}</span>
          )}
        </div>
        <div className="rounded-lg border bg-muted/30 px-3 py-2">
          <EmailBody text={reply.body} />
        </div>
      </div>
    </div>
  );
}

// ── Skeleton loaders ──────────────────────────────────────────────────────────
function TaskSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-48 rounded" />
      <div className="rounded-xl border p-5 space-y-4">
        <Skeleton className="h-6 w-64" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}
        </div>
      </div>
      <div className="rounded-xl border p-5 space-y-3">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-7 w-7 rounded-full shrink-0" />
            <Skeleton className="h-20 flex-1 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const [task, setTask] = useState<TaskFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    authFetch(`${API_URL}/api/candidates/task/${taskId}?full=true`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) throw new Error(json.error);
        setTask(json.task);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [taskId, authFetch]);

  return (
    <DashboardLayout>
      <div className="px-4 md:px-6 py-4 space-y-4 max-w-3xl mx-auto">
        {/* Back */}
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs -ml-1" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>

        {loading && <TaskSkeleton />}

        {error && (
          <div className="text-sm text-destructive p-4 rounded-md border border-destructive/30">
            Failed to load task: {error}
          </div>
        )}

        {task && !loading && (
          <>
            {/* ── Task Header Card ── */}
            <Card>
              <CardContent className="p-5">
                {/* Title row */}
                <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
                  <div className="flex-1 min-w-0">
                    <h1 className="text-base font-bold leading-tight">
                      {task.candidateName || 'Task Detail'}
                    </h1>
                    {task.subject && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.subject}</p>
                    )}
                  </div>
                  {task.candidateId && (
                    <Link to={`/candidate/${task.candidateId}`}>
                      <Button variant="outline" size="sm" className="text-xs gap-1.5 shrink-0">
                        <ExternalLink className="h-3.5 w-3.5" /> View Profile
                      </Button>
                    </Link>
                  )}
                </div>

                {/* Status + date strip */}
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  {task.status && (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${statusClass(task.status)}`}>
                      {task.status}
                    </span>
                  )}
                  {task.date && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />{task.date}
                    </span>
                  )}
                  {(task.startTime || task.endTime) && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {[task.startTime, task.endTime].filter(Boolean).join(' – ')}
                    </span>
                  )}
                  {task.receivedAt && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      Received: {formatDateTime(task.receivedAt)}
                    </span>
                  )}
                </div>

                <Separator className="mb-4" />

                {/* Details grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3.5">
                  <Field icon={Building2} label="Client"       value={task.client} />
                  <Field icon={Briefcase} label="Job Title"    value={task.role} />
                  <Field icon={Layers}    label="Round"        value={task.round} />
                  <Field icon={Layers}    label="Actual Round" value={task.actualRound} />
                  <Field icon={Building2} label="Vendor"       value={task.vendor} />
                  <Field icon={Mail}      label="Candidate Email" value={task.emailId} />
                  <Field icon={Mail}      label="Recruiter"
                    value={task.recruiter ? (task.recruiter.includes('@') ? formatEmail(task.recruiter) : task.recruiter) : null} />
                  <Field icon={User}      label="Expert"
                    value={task.assignedTo ? (task.assignedTo.includes('@') ? formatEmail(task.assignedTo) : task.assignedTo) : null} />
                  <Field icon={Clock}     label="Assigned At"  value={formatDate(task.assignedAt)} />
                </div>

                {/* Suggestions */}
                {task.suggestions.length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Expert Suggestions</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {task.suggestions.map((s, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px] px-1.5">{s}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Email Thread ── */}
            {(task.body || task.replies.length > 0) && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Email Thread
                    <span className="text-xs font-normal text-muted-foreground ml-auto">
                      {task.replies.length + (task.body ? 1 : 0)} message{task.replies.length + (task.body ? 1 : 0) !== 1 ? 's' : ''}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-5 space-y-4">
                  {/* Original email body */}
                  {task.body && (
                    <ReplyBubble
                      reply={{ body: task.body, from: task.recruiter, receivedAt: task.receivedAt }}
                      index={0}
                    />
                  )}

                  {/* Separator between original and replies */}
                  {task.body && task.replies.length > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[10px] text-muted-foreground">{task.replies.length} repl{task.replies.length === 1 ? 'y' : 'ies'}</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  )}

                  {/* Replies */}
                  {task.replies.map((reply, i) => (
                    <ReplyBubble key={i} reply={reply} index={task.body ? i + 1 : i} />
                  ))}
                </CardContent>
              </Card>
            )}

            {/* ── No email body fallback ── */}
            {!task.body && task.replies.length === 0 && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
                  <FileText className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-xs text-muted-foreground">No email thread available for this task.</p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
