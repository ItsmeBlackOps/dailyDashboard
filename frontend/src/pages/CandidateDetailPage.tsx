import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, User, MapPin, Briefcase, Mail, Phone, Calendar, ExternalLink,
  Clock, CheckCircle2, AlertCircle, Pause, TrendingDown, Star, HelpCircle,
  ChevronDown, ChevronUp, Building2, Layers, Users,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { statusColors, type CandidateStatus } from '@/components/profile-hub/mockData';
import { TaskSheet } from '@/components/shared/TaskSheet';
import { PODraftSheet } from '@/components/shared/PODraftSheet';
import type { TaskSheetPrefill } from '@/components/shared/TaskSheet';
import FindJobsDialog from '@/components/jobs/FindJobsDialog';

// ── Types ────────────────────────────────────────────────────────────────────
interface Candidate {
  id: string; name: string; email: string; contact: string;
  technology: string; branch: string; recruiter: string; expert: string;
  status: string; poDate: string | null; receivedDate: string | null;
  updatedAt: string | null; resumeLink: string | null;
  statusHistory: { status: string; changedAt: string; changedBy: string }[];
  workflowStatus: string;
}

interface Interview {
  taskId: string;
  date: string | null; startTime: string | null; endTime: string | null;
  role: string; client: string; round: string; actualRound: string;
  vendor: string; status: string; assignedTo: string; assignedAt: string | null;
  recruiter: string; suggestions: string[]; receivedAt: string | null;
}

// ── Timeline event types ──────────────────────────────────────────────────────
type TimelineEvent =
  | { kind: 'created';  at: Date; label: string }
  | { kind: 'status';   at: Date; status: string; changedBy: string }
  | { kind: 'interview'; at: Date; task: Interview };

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatEmail(email: string) {
  if (!email) return '';
  if (!email.includes('@')) return email;
  return email.split('@')[0].split(/[._]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

function formatDate(d: string | Date | null, short = false) {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString('en-GB', short
    ? { day: '2-digit', month: 'short' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysAgo(d: string | null) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

function parseDate(s: string | null): Date | null {
  if (!s) return null;
  // Handle MM/DD/YYYY format
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    const [m, d, y] = s.split('/').map(Number);
    return new Date(y, m - 1, d);
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_ICONS: Record<string, React.ElementType> = {
  'Active':           CheckCircle2,
  'Placement Offer':  Star,
  'Hold':             Pause,
  'Backout':          AlertCircle,
  'Low Priority':     TrendingDown,
  'Unassigned':       HelpCircle,
};

const STATUS_DOT: Record<string, string> = {
  'Active':           'bg-emerald-500',
  'Placement Offer':  'bg-violet-500',
  'Hold':             'bg-amber-500',
  'Backout':          'bg-red-500',
  'Low Priority':     'bg-sky-400',
  'Unassigned':       'bg-muted-foreground/40',
};

const TASK_STATUS_CLASS: Record<string, string> = {
  completed:   'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  done:        'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  selected:    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300',
  cancelled:   'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300',
  rescheduled: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300',
};

function taskStatusClass(status: string) {
  return TASK_STATUS_CLASS[(status || '').toLowerCase()] ?? 'bg-muted/50 text-foreground border-border';
}

// ── Expanded task card ────────────────────────────────────────────────────────
function TaskCard({ task }: { task: Interview }) {
  const [open, setOpen] = useState(false);
  const expertDisplay = task.assignedTo
    ? (task.assignedTo.includes('@') ? formatEmail(task.assignedTo) : task.assignedTo)
    : null;
  const recruiterDisplay = task.recruiter
    ? (task.recruiter.includes('@') ? formatEmail(task.recruiter) : task.recruiter)
    : null;

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
      {/* Header row — always visible */}
      <button
        className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold truncate">{task.client || 'Client N/A'}</span>
            {task.round && (
              <Badge variant="outline" className="text-[10px] px-1.5 shrink-0">{task.round}</Badge>
            )}
            {task.status && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${taskStatusClass(task.status)}`}>
                {task.status}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            {task.startTime && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Clock className="h-3 w-3" />
                {task.startTime}{task.endTime ? ` – ${task.endTime}` : ''}
              </span>
            )}
            {expertDisplay && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <User className="h-3 w-3" />
                {expertDisplay}
              </span>
            )}
          </div>
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
               : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      </button>

      {/* Expanded details */}
      {open && (
        <div className="px-3.5 pb-3 pt-0 border-t bg-muted/20">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2.5">
            {task.role && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Briefcase className="h-3 w-3" /> Job Title</div>
                <div className="text-xs font-medium">{task.role}</div>
              </div>
            )}
            {task.actualRound && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Layers className="h-3 w-3" /> Actual Round</div>
                <div className="text-xs font-medium">{task.actualRound}</div>
              </div>
            )}
            {task.vendor && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" /> Vendor</div>
                <div className="text-xs font-medium">{task.vendor}</div>
              </div>
            )}
            {recruiterDisplay && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3" /> Recruiter</div>
                <div className="text-xs font-medium">{recruiterDisplay}</div>
              </div>
            )}
            {task.assignedAt && (
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Assigned At</div>
                <div className="text-xs font-medium">{formatDate(task.assignedAt)}</div>
              </div>
            )}
          </div>
          {task.suggestions && task.suggestions.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1 mb-1"><Users className="h-3 w-3" /> Expert Suggestions</div>
              <div className="flex flex-wrap gap-1">
                {task.suggestions.map((s, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px] px-1.5">{s}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CandidateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [poPrefill, setPoPrefill] = useState<TaskSheetPrefill | null>(null);
  const [poSheetOpen, setPoSheetOpen] = useState(false);
  const [findJobsOpen, setFindJobsOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    authFetch(`${API_URL}/api/candidates/${id}`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) throw new Error(json.error);
        setCandidate(json.candidate);
        setInterviews(json.interviews || []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, authFetch]);

  // Build merged chronological timeline
  const timeline: TimelineEvent[] = [];

  if (candidate) {
    // Created event
    const createdAt = parseDate(candidate.receivedDate);
    if (createdAt) {
      timeline.push({ kind: 'created', at: createdAt, label: 'Candidate profile created' });
    }

    // Status history events
    for (const entry of candidate.statusHistory) {
      const at = parseDate(entry.changedAt);
      if (at) timeline.push({ kind: 'status', at, status: entry.status, changedBy: entry.changedBy });
    }

    // Interview task events
    for (const task of interviews) {
      const at = parseDate(task.receivedAt) ?? parseDate(task.date);
      if (at) timeline.push({ kind: 'interview', at, task });
    }

    // Synthetic PO event from poDate if no statusHistory entry covers it
    if (candidate.poDate) {
      const hasPoEntry = candidate.statusHistory.some(
        (e) => (e.status || '').toLowerCase().includes('placement offer')
      );
      if (!hasPoEntry) {
        const poAt = parseDate(candidate.poDate);
        if (poAt) timeline.push({ kind: 'status', at: poAt, status: 'Placement Offer', changedBy: 'system' });
      }
    }

    // Sort newest first
    timeline.sort((a, b) => b.at.getTime() - a.at.getTime());
  }

  return (
    <DashboardLayout>
      <div className="px-4 md:px-6 py-4 space-y-5 max-w-3xl mx-auto">
        {/* Back */}
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs -ml-1" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>

        {loading && (
          <div className="space-y-4">
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive p-4 rounded-md border border-destructive/30">
            Failed to load candidate: {error}
          </div>
        )}

        {candidate && (
          <>
            {/* ── Profile card ── */}
            <Card className="overflow-hidden">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-lg font-bold shrink-0">
                      {candidate.name.charAt(0)}
                    </div>
                    <div>
                      <h1 className="text-lg font-bold leading-tight">{candidate.name}</h1>
                      <p className="text-sm text-muted-foreground mt-0.5">{candidate.technology || 'Technology not set'}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${statusColors[(candidate.status as CandidateStatus)] || ''}`}>
                          {candidate.status}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1.5">{candidate.branch}</Badge>
                        {candidate.workflowStatus && (
                          <Badge variant="secondary" className="text-[10px] px-1.5">{candidate.workflowStatus}</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {candidate.status === 'Placement Offer' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5"
                        onClick={() => {
                          setPoPrefill({
                            taskId: '',
                            candidateId: candidate.id,
                            candidateName: candidate.name,
                            emailId: candidate.email || '',
                            position: candidate.technology || '',
                            recruiter: candidate.recruiter || '',
                            branch: candidate.branch || '',
                          });
                          setPoSheetOpen(true);
                        }}
                      >
                        + Create PO Draft
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs gap-1.5"
                      onClick={() => setFindJobsOpen(true)}
                    >
                      <Briefcase className="h-3.5 w-3.5" /> Find Jobs
                    </Button>
                    {candidate.resumeLink && (
                      <a href={candidate.resumeLink} target="_blank" rel="noopener noreferrer">
                        <Button variant="outline" size="sm" className="text-xs gap-1.5">
                          <ExternalLink className="h-3.5 w-3.5" /> Resume
                        </Button>
                      </a>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t">
                  {[
                    { icon: Mail,      label: 'Email',     value: candidate.email },
                    { icon: Phone,     label: 'Contact',   value: candidate.contact || null },
                    { icon: User,      label: 'Recruiter', value: candidate.recruiter ? formatEmail(candidate.recruiter) : null },
                    { icon: Briefcase, label: 'Expert',    value: candidate.expert ? formatEmail(candidate.expert) : null },
                    { icon: MapPin,    label: 'Branch',    value: candidate.branch },
                    { icon: Calendar,  label: 'Updated',
                      value: candidate.updatedAt
                        ? `${formatDate(candidate.updatedAt)} (${daysAgo(candidate.updatedAt)}d ago)`
                        : null },
                  ].filter(f => f.value).map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex items-start gap-2">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
                        <div className="text-xs font-medium break-all">{value}</div>
                      </div>
                    </div>
                  ))}
                  {candidate.poDate && (
                    <div className="flex items-start gap-2">
                      <Calendar className="h-3.5 w-3.5 text-violet-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">PO Date</div>
                        <div className="text-xs font-medium text-violet-400">{formatDate(candidate.poDate)}</div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ── Vertical Timeline ── */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  Full Activity Timeline
                  <span className="text-xs font-normal text-muted-foreground ml-auto">{timeline.length} events</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-5 pt-1">
                {timeline.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4">No timeline events found.</p>
                ) : (
                  <div className="relative">
                    {/* Vertical guide line */}
                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

                    <div className="space-y-0">
                      {timeline.map((event, i) => {
                        const isLast = i === timeline.length - 1;

                        if (event.kind === 'created') {
                          return (
                            <div key={i} className="flex gap-4 pb-5 relative">
                              <div className="shrink-0 w-4 flex flex-col items-center">
                                <div className="w-3.5 h-3.5 rounded-full bg-primary ring-2 ring-background z-10 mt-0.5" />
                              </div>
                              <div className="flex-1 min-w-0 pt-0">
                                <div className="text-[10px] text-muted-foreground font-mono">{formatDate(event.at)}</div>
                                <div className="text-xs font-semibold text-primary mt-0.5">
                                  {event.label}
                                </div>
                              </div>
                            </div>
                          );
                        }

                        if (event.kind === 'status') {
                          const StatusIcon = STATUS_ICONS[event.status] ?? HelpCircle;
                          return (
                            <div key={i} className={`flex gap-4 ${isLast ? '' : 'pb-5'} relative`}>
                              <div className="shrink-0 w-4 flex flex-col items-center">
                                <div className={`w-3.5 h-3.5 rounded-full ring-2 ring-background z-10 mt-0.5 ${STATUS_DOT[event.status] ?? 'bg-muted-foreground/40'}`} />
                              </div>
                              <div className="flex-1 min-w-0 pt-0">
                                <div className="text-[10px] text-muted-foreground font-mono">{formatDate(event.at)}</div>
                                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                                  <StatusIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${statusColors[(event.status as CandidateStatus)] || ''}`}>
                                    {event.status}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">
                                    by {event.changedBy === 'system-backfill' ? 'System' : formatEmail(event.changedBy)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        if (event.kind === 'interview') {
                          return (
                            <div key={i} className={`flex gap-4 ${isLast ? '' : 'pb-5'} relative`}>
                              <div className="shrink-0 w-4 flex flex-col items-center">
                                <div className="w-3.5 h-3.5 rounded-full bg-indigo-500 ring-2 ring-background z-10 mt-0.5 flex items-center justify-center">
                                  <Calendar className="h-2 w-2 text-white" />
                                </div>
                              </div>
                              <div className="flex-1 min-w-0 pt-0">
                                <div className="text-[10px] text-muted-foreground font-mono mb-1">
                                  {formatDate(event.at)}
                                  {event.task.startTime && (
                                    <span className="ml-2">{event.task.startTime}</span>
                                  )}
                                </div>
                                <div
                                  className={event.task.taskId ? 'cursor-pointer' : ''}
                                  onClick={() => event.task.taskId && setSelectedTaskId(event.task.taskId)}
                                >
                                  <TaskCard task={event.task} />
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return null;
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Summary counts ── */}
            {interviews.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Total Interviews', value: interviews.length, color: 'text-foreground' },
                  { label: 'Completed', value: interviews.filter(i => ['completed','done','selected'].includes((i.status||'').toLowerCase())).length, color: 'text-emerald-600' },
                  { label: 'Status Changes', value: candidate.statusHistory.length, color: 'text-violet-600' },
                ].map(({ label, value, color }) => (
                  <Card key={label}>
                    <CardContent className="p-3 text-center">
                      <div className={`text-xl font-bold ${color}`}>{value}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <TaskSheet
        taskId={selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        onCreatePO={(prefill) => {
          setPoPrefill(prefill);
          setPoSheetOpen(true);
        }}
      />
      <PODraftSheet
        open={poSheetOpen}
        onClose={() => { setPoSheetOpen(false); setPoPrefill(null); }}
        prefill={poPrefill}
      />
      {candidate && (
        <FindJobsDialog
          open={findJobsOpen}
          onOpenChange={setFindJobsOpen}
          candidateId={candidate.id}
          candidateName={candidate.name}
        />
      )}
    </DashboardLayout>
  );
}
