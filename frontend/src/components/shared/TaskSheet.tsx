import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar, Clock, Building2, Briefcase, User, Mail,
  Layers, Users, ExternalLink, MessageSquare, FileText,
} from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useAuth, API_URL } from '@/hooks/useAuth';
import BotStatusBadge from './BotStatusBadge';

// ── Types ────────────────────────────────────────────────────────────────────
interface TaskReply {
  body: string;
  from: string;
  receivedAt: string | null;
}

export interface TaskSheetPrefill {
  taskId: string;
  candidateId?: string | null;
  candidateName: string;
  emailId?: string;
  endClient?: string;
  position?: string;
  vendor?: string;
  branch?: string;
  recruiter?: string;
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
  meetingLink: string | null;
  meetingPassword: string | null;
  botStatus: string | null;
  botInviteAttempts: number | null;
  botJoinedAt: string | null;
  botLastError: string | null;
}

interface TaskSheetProps {
  taskId: string | null;
  onClose: () => void;
  onCreatePO?: (prefill: TaskSheetPrefill) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
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
  return dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_CLASS: Record<string, string> = {
  completed:   'bg-aurora-emerald/10 text-aurora-emerald border-aurora-emerald/30',
  done:        'bg-aurora-emerald/10 text-aurora-emerald border-aurora-emerald/30',
  selected:    'bg-aurora-emerald/10 text-aurora-emerald border-aurora-emerald/30',
  cancelled:   'bg-destructive/10 text-destructive border-destructive/30',
  rescheduled: 'bg-aurora-amber/10 text-aurora-amber border-aurora-amber/30',
};
function statusClass(s: string) {
  return STATUS_CLASS[(s || '').toLowerCase()] ?? 'bg-muted text-foreground border-border';
}

function Field({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string | null }) {
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

function EmailBody({ text }: { text: string }) {
  if (!text) return null;
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return (
    <pre className="text-xs text-foreground/80 whitespace-pre-wrap break-words font-sans leading-relaxed">
      {cleaned}
    </pre>
  );
}

function ReplyBubble({ reply, index }: { reply: TaskReply; index: number }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold mt-0.5">
        {reply.from ? reply.from.charAt(0).toUpperCase() : '?'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="text-xs font-semibold">
            {reply.from
              ? (reply.from.includes('@') ? formatEmail(reply.from) : reply.from)
              : 'Unknown'}
          </span>
          {index === 0 && <Badge variant="secondary" className="text-[9px] px-1">Original</Badge>}
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

function TaskSheetSkeleton() {
  return (
    <div className="space-y-4 p-4">
      <Skeleton className="h-6 w-48" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}
      </div>
      <Skeleton className="h-5 w-32" />
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="h-7 w-7 rounded-full shrink-0" />
          <Skeleton className="h-20 flex-1 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export function TaskSheet({ taskId, onClose, onCreatePO }: TaskSheetProps) {
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const [task, setTask] = useState<TaskFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [savingLink, setSavingLink] = useState(false);

  useEffect(() => {
    if (!taskId) { setTask(null); setError(null); return; }
    setLoading(true);
    setError(null);
    authFetch(`${API_URL}/api/candidates/task/${taskId}?full=true`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) throw new Error(json.error);
        setTask(json.task);
        setLinkDraft(json.task.meetingLink ?? '');
        setPasswordDraft(json.task.meetingPassword ?? '');
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [taskId, authFetch]);

  const handleSaveMeetingLink = async () => {
    if (!taskId || !linkDraft.trim()) return;
    setSavingLink(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`/api/tasks/${taskId}/meeting-link`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ meetingLink: linkDraft.trim(), meetingPassword: passwordDraft.trim() || null }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const data = await res.json();
      setTask(data.task);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingLink(false);
    }
  };

  const handleCreatePO = () => {
    if (!task || !onCreatePO) return;
    onCreatePO({
      taskId: task.taskId,
      candidateId: task.candidateId,
      candidateName: task.candidateName,
      emailId: task.emailId,
      endClient: task.client,
      position: task.role,
      vendor: task.vendor,
      recruiter: task.recruiter,
    });
  };

  return (
    <Sheet open={!!taskId} onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto flex flex-col gap-0 p-0">
        <SheetHeader className="px-5 pt-5 pb-3 border-b">
          <SheetTitle className="text-sm">
            {task ? task.candidateName : 'Task Details'}
          </SheetTitle>
          {task?.subject && (
            <p className="text-xs text-muted-foreground truncate">{task.subject}</p>
          )}
        </SheetHeader>

        {loading && <TaskSheetSkeleton />}
        {error && (
          <div className="p-4 text-sm text-destructive">{error}</div>
        )}

        {task && !loading && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Status + date strip */}
            <div className="flex flex-wrap items-center gap-2">
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
                  {formatDateTime(task.receivedAt)}
                </span>
              )}
            </div>

            <Separator />

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3.5">
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

            {/* Meeting Link */}
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Meeting Link</h4>
                <BotStatusBadge status={task.botStatus ?? undefined} attempts={task.botInviteAttempts ?? undefined} error={task.botLastError} />
              </div>
              {task.meetingLink ? (
                <a href={task.meetingLink} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline break-all">
                  {task.meetingLink}
                </a>
              ) : (
                <p className="text-xs text-muted-foreground">No meeting link set yet</p>
              )}
              {task.botLastError && (
                <p className="text-xs text-aurora-rose">⚠️ {task.botLastError}</p>
              )}
              <div className="space-y-2 pt-2 border-t">
                <Input
                  placeholder="https://zoom.us/j/..."
                  value={linkDraft}
                  onChange={(e) => setLinkDraft(e.target.value)}
                  className="h-8 text-xs"
                />
                <Input
                  placeholder="Password (optional)"
                  value={passwordDraft}
                  onChange={(e) => setPasswordDraft(e.target.value)}
                  className="h-8 text-xs"
                />
                <Button size="sm" onClick={handleSaveMeetingLink} disabled={savingLink}>
                  {savingLink ? 'Saving...' : 'Save & Invite Bot'}
                </Button>
              </div>
            </div>

            {/* Suggestions */}
            {task.suggestions?.length > 0 && (
              <div className="pt-1">
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

            {/* Email thread */}
            {(task.body || task.replies?.length > 0) && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-semibold">Email Thread</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {(task.replies?.length ?? 0) + (task.body ? 1 : 0)} message{(task.replies?.length ?? 0) + (task.body ? 1 : 0) !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-3">
                  {task.body && (
                    <ReplyBubble reply={{ body: task.body, from: task.recruiter, receivedAt: task.receivedAt }} index={0} />
                  )}
                  {task.body && task.replies?.length > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-[10px] text-muted-foreground">{task.replies.length} repl{task.replies.length === 1 ? 'y' : 'ies'}</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                  )}
                  {task.replies?.map((reply, i) => (
                    <ReplyBubble key={i} reply={reply} index={task.body ? i + 1 : i} />
                  ))}
                </div>
              </div>
            )}

            {!task.body && !task.replies?.length && (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <FileText className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">No email thread for this task.</p>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        {task && !loading && (
          <div className="border-t px-5 py-3 flex gap-2 shrink-0">
            {onCreatePO && (
              <Button variant="default" size="sm" className="text-xs gap-1.5 flex-1" onClick={handleCreatePO}>
                ＋ Create PO Draft
              </Button>
            )}
            {task.candidateId && (
              <Button variant="outline" size="sm" className="text-xs gap-1.5 flex-1"
                onClick={() => { onClose(); navigate(`/candidate/${task.candidateId}`); }}>
                <ExternalLink className="h-3.5 w-3.5" /> Candidate Profile
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-xs gap-1.5"
              onClick={() => { onClose(); navigate(`/task/${taskId}`); }}>
              Full Page
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
