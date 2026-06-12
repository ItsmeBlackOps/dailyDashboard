import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseJsonOrThrow } from '@/lib/fetchJson';
import { canSeeBotStatus } from '@/lib/roleAliases';
import {
  Calendar, Clock, Building2, Briefcase, User, Mail, UserPlus, X as XIcon,
  Layers, Users, ExternalLink, MessageSquare, FileText, Video, Check, Loader2,
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
import { useToast } from '@/hooks/use-toast';
import { fetchEligible, type EligiblePerson } from '@/lib/delegationApi';
import {
  addCoAssignee, approveCoAssignee, rejectCoAssignee, removeCoAssignee,
} from '@/lib/coAssignApi';
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
  joinUrl?: string | null;
  joinWebUrl?: string | null;
  meetingPassword: string | null;
  botStatus: string | null;
  botInviteAttempts: number | null;
  botJoinedAt: string | null;
  botLastError: string | null;
  meetingStarted?: boolean;
  meetingStartedAt?: string | null;
  meetingStartedBy?: string | null;
  meetingStartedSource?: string | null;
  coAssignees?: string[];
  pendingCoAssigns?: { email: string; requestedBy: string; requestedAt: string; approverEmail: string }[];
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
  const { toast } = useToast();
  const [task, setTask] = useState<TaskFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [savingLink, setSavingLink] = useState(false);
  const [reinviting, setReinviting] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!taskId) { setTask(null); setError(null); return; }
    setLoading(true);
    setError(null);
    authFetch(`${API_URL}/api/candidates/task/${taskId}?full=true`)
      .then(parseJsonOrThrow)
      .then((json: { success: boolean; task: typeof task; error?: string }) => {
        if (!json.success) throw new Error(json.error || 'Request failed');
        setTask(json.task);
        setLinkDraft(json.task?.meetingLink ?? '');
        setPasswordDraft(json.task?.meetingPassword ?? '');
      })
      .catch((e: Error) => {
        // HttpError carries status + url; show a clean message to the
        // user, leave the technical detail in console (logged by helper).
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [taskId, authFetch, refreshKey]);

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

  const handleReinviteBot = async () => {
    if (!taskId) return;
    setReinviting(true);
    try {
      const res = await authFetch(`${API_URL}/api/tasks/${taskId}/invite-bot`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || data.message || `HTTP ${res.status}`);
      toast({ title: 'Recorder invited', description: data.message || 'Fred should join within a minute.' });
    } catch (err) {
      toast({ title: 'Re-invite failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setReinviting(false);
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

            {/* People on this task — owner + co-experts (2026-06-12 redesign) */}
            <PeopleOnTask task={task} onChanged={() => setRefreshKey((k) => k + 1)} />

            {/* Meeting Link */}
            <div className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">Meeting Link</h4>
                {canSeeBotStatus() && (
                  <BotStatusBadge status={task.botStatus ?? undefined} attempts={task.botInviteAttempts ?? undefined} error={task.botLastError} />
                )}
              </div>

              {(() => {
                const link = task.meetingLink || task.joinUrl || task.joinWebUrl;
                if (link) {
                  // Link is set — show Join button + lifecycle stepper.
                  // The Fireflies scheduler picks the link up on its next 60s
                  // tick, so no manual re-save is required for the bot.
                  return (
                    <>
                      <Button
                        size="sm"
                        asChild
                        className="w-full bg-gradient-to-r from-aurora-violet to-aurora-cyan text-white gap-1.5"
                      >
                        <a href={link} target="_blank" rel="noopener noreferrer">
                          <Video className="h-3.5 w-3.5" />
                          Join Meeting
                          <ExternalLink className="h-3 w-3 ml-auto opacity-80" />
                        </a>
                      </Button>
                      {/* One-click recorder rescue — pairs with the
                          "recorder missing" alert; server enforces who may. */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full gap-1.5 text-xs"
                        disabled={reinviting}
                        onClick={() => void handleReinviteBot()}
                      >
                        {reinviting ? 'Inviting recorder…' : 'Re-invite recorder (Fred)'}
                      </Button>
                      {canSeeBotStatus() && (
                        <BotLifecycle
                          status={task.botStatus ?? null}
                          attempts={task.botInviteAttempts ?? 0}
                          joinedAt={task.botJoinedAt ?? null}
                          error={task.botLastError ?? null}
                        />
                      )}
                    </>
                  );
                }
                // No link yet — fall through to the manual input UI.
                return (
                  <>
                    <p className="text-xs text-muted-foreground">No meeting link set yet</p>
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
                  </>
                );
              })()}

              {task.botLastError && canSeeBotStatus() && (
                <p className="text-xs text-aurora-rose">⚠️ {task.botLastError}</p>
              )}
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

            {/* Meeting start — manual dashboard click or the Meeting Detector
                extension (source 'extension'). Sits right above Email Thread. */}
            <div
              className={`rounded-lg border px-3 py-2.5 flex items-center gap-2.5 ${
                task.meetingStarted
                  ? 'border-aurora-emerald/30 bg-aurora-emerald/5'
                  : 'bg-muted/30'
              }`}
            >
              <Video
                className={`h-3.5 w-3.5 shrink-0 ${
                  task.meetingStarted ? 'text-aurora-emerald' : 'text-muted-foreground'
                }`}
              />
              {task.meetingStarted ? (
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-aurora-emerald">
                    Meeting started
                    {task.meetingStartedAt ? ` · ${formatDateTime(task.meetingStartedAt)}` : ''}
                  </div>
                  {(task.meetingStartedBy || task.meetingStartedSource === 'extension') && (
                    <div className="text-[10px] text-muted-foreground">
                      {task.meetingStartedBy ? `by ${formatEmail(task.meetingStartedBy)}` : ''}
                      {task.meetingStartedSource === 'extension' ? ' · auto-detected (extension)' : ''}
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">Meeting not started yet</span>
              )}
            </div>

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

// ── People on this task ─────────────────────────────────────────────────────
// Owner + co-experts, with add (dropdown of department experts — instant
// for the expert's own lead/admin, pending that lead's approval otherwise),
// approve/reject for pending entries, and remove. Authority is enforced
// server-side; failed actions surface as toasts.

function PeopleOnTask({ task, onChanged }: { task: TaskFull; onChanged: () => void }) {
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const [experts, setExperts] = useState<EligiblePerson[]>([]);
  const [adding, setAdding] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);

  const ownerEmail = (task.assignedTo || '').toLowerCase();
  const coAssignees = task.coAssignees || [];
  const pending = task.pendingCoAssigns || [];

  useEffect(() => {
    if (!pickOpen || experts.length > 0) return;
    fetchEligible(authFetch, API_URL)
      .then((e) => setExperts(e.deptExperts || []))
      .catch(() => setExperts([]));
  }, [pickOpen, experts.length, authFetch]);

  const act = async (fn: () => Promise<unknown>, okTitle: string) => {
    try {
      await fn();
      toast({ title: okTitle });
      onChanged();
    } catch (err) {
      toast({ title: 'Action failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleAdd = async (email: string) => {
    setAdding(true);
    setPickOpen(false);
    try {
      const r = await addCoAssignee(authFetch, API_URL, task.taskId, email);
      toast({
        title: r.status === 'pending' ? 'Sent for approval' : 'Co-expert added',
        description: r.status === 'pending'
          ? `${formatEmail(email)} joins once ${formatEmail(r.approverEmail || '')} approves.`
          : `${formatEmail(email)} is now on this task.`,
      });
      onChanged();
    } catch (err) {
      toast({ title: 'Could not add', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const taken = new Set([ownerEmail, ...coAssignees, ...pending.map((p) => p.email)]);
  const options = experts.filter((e) => !taken.has(e.email));

  return (
    <div className="rounded-lg border p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">People on this task</h4>
        {!pickOpen ? (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={adding}
            onClick={() => setPickOpen(true)}>
            <UserPlus className="h-3 w-3" /> Add co-expert
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPickOpen(false)}>
            Cancel
          </Button>
        )}
      </div>

      {pickOpen && (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-1.5">
          {options.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">No other eligible experts found.</p>
          ) : (
            options.map((e) => (
              <button
                key={e.email}
                type="button"
                onClick={() => void handleAdd(e.email)}
                className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-muted"
              >
                <span>{formatEmail(e.email)}</span>
                <span className="text-[10px] text-muted-foreground">
                  {e.mine ? 'your team' : e.teamLead ? `under ${e.teamLead}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      <div className="space-y-1.5">
        {ownerEmail && (
          <div className="flex items-center gap-2 text-xs">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{formatEmail(ownerEmail)}</span>
            <Badge variant="secondary" className="text-[9px] px-1">owner</Badge>
          </div>
        )}
        {coAssignees.map((email) => (
          <div key={email} className="flex items-center gap-2 text-xs">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{formatEmail(email)}</span>
            <Badge variant="outline" className="border-violet-400/60 bg-violet-500/10 text-violet-600 text-[9px] px-1">
              co-expert
            </Badge>
            <button
              type="button"
              aria-label={`Remove ${formatEmail(email)}`}
              className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => void act(
                () => removeCoAssignee(authFetch, API_URL, task.taskId, email),
                'Co-expert removed',
              )}
            >
              <XIcon className="h-3 w-3" />
            </button>
          </div>
        ))}
        {pending.map((pc) => (
          <div key={pc.email} className="flex flex-wrap items-center gap-2 text-xs">
            <Users className="h-3.5 w-3.5 text-amber-500" />
            <span className="font-medium">{formatEmail(pc.email)}</span>
            <Badge variant="outline" className="border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[9px] px-1">
              pending {formatEmail(pc.approverEmail)}
            </Badge>
            <span className="ml-auto flex gap-1">
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                onClick={() => void act(
                  () => approveCoAssignee(authFetch, API_URL, task.taskId, pc.email),
                  'Co-expert approved',
                )}>
                Approve
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]"
                onClick={() => void act(
                  () => rejectCoAssignee(authFetch, API_URL, task.taskId, pc.email),
                  'Request declined',
                )}>
                Reject
              </Button>
            </span>
          </div>
        ))}
        {!coAssignees.length && !pending.length && (
          <p className="text-xs text-muted-foreground">No co-experts yet.</p>
        )}
      </div>
    </div>
  );
}

// ── Bot lifecycle stepper ───────────────────────────────────────────────────

interface LifecycleProps {
  status: string | null;
  attempts: number;
  joinedAt: string | null;
  error: string | null;
}

const LIFECYCLE_ORDER = [
  'pending',
  'precheck_invited',
  'precheck_joined',
  'main_invited',
  'main_joined',
] as const;

const LIFECYCLE_LABEL: Record<string, string> = {
  pending:           'Waiting for window',
  precheck_invited:  'Pre-check sent',
  precheck_joined:   'Link verified',
  precheck_failed:   'Link failed pre-check',
  main_invited:      'Bot invited',
  main_joined:       'Bot joined',
  main_failed:       'Bot failed after retries',
};

function lifecyclePosition(status: string | null): number {
  if (!status) return 0;
  const i = LIFECYCLE_ORDER.indexOf(status as (typeof LIFECYCLE_ORDER)[number]);
  // Failed states: align to where they failed.
  if (i === -1) {
    if (status === 'precheck_failed') return 1;  // failed at precheck step
    if (status === 'main_failed')     return 3;  // failed at main-invite step
    return 0;
  }
  return i;
}

function BotLifecycle({ status, attempts, joinedAt, error }: LifecycleProps) {
  const position = lifecyclePosition(status);
  const isFailed = status === 'precheck_failed' || status === 'main_failed';
  const currentLabel = (status && LIFECYCLE_LABEL[status]) || 'Not yet scheduled';

  return (
    <div className="rounded-md border bg-card/40 p-2.5 space-y-2">
      <div className="flex items-center justify-between text-[10.5px]">
        <span className="text-muted-foreground">Recording bot</span>
        <span
          className={
            isFailed
              ? 'font-mono text-aurora-rose'
              : status === 'main_joined'
                ? 'font-mono text-aurora-emerald'
                : 'font-mono text-foreground/80'
          }
        >
          {currentLabel}
          {attempts > 1 && status?.startsWith('main') && ` · attempt ${attempts}`}
        </span>
      </div>

      {/* Step rail */}
      <div className="flex items-center gap-1">
        {LIFECYCLE_ORDER.map((s, i) => {
          const reached = i <= position;
          const isCurrent = i === position && !isFailed;
          const dotClass = isFailed && i === position
            ? 'bg-aurora-rose border-aurora-rose'
            : reached
              ? 'bg-aurora-violet border-aurora-violet'
              : 'bg-transparent border-border';
          const lineClass = i < position
            ? 'bg-aurora-violet'
            : 'bg-border';
          return (
            <div key={s} className="flex items-center flex-1 last:flex-none">
              <div
                className={`h-2.5 w-2.5 rounded-full border-2 shrink-0 ${dotClass} ${
                  isCurrent ? 'ring-2 ring-aurora-violet/30' : ''
                }`}
                title={LIFECYCLE_LABEL[s]}
                aria-label={LIFECYCLE_LABEL[s]}
              >
                {reached && status === 'main_joined' && i === LIFECYCLE_ORDER.length - 1 && (
                  <Check className="h-2 w-2 text-white -translate-y-[1px]" aria-hidden />
                )}
                {isCurrent && !isFailed && (
                  <Loader2 className="h-2.5 w-2.5 text-white animate-spin -translate-x-[1px] -translate-y-[1px]" aria-hidden />
                )}
              </div>
              {i < LIFECYCLE_ORDER.length - 1 && (
                <div className={`h-[2px] flex-1 mx-0.5 ${lineClass}`} />
              )}
            </div>
          );
        })}
      </div>

      {joinedAt && status === 'main_joined' && (
        <p className="text-[10px] text-muted-foreground">
          Joined at {new Date(joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
      {error && (
        <p className="text-[10px] text-aurora-rose break-words">⚠ {error}</p>
      )}
    </div>
  );
}
