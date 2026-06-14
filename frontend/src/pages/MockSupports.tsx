// Mock Supports — queue + create drawer + detail drawer (PR-1).
// One primary CTA per state drives the flow; chat (PR-2), meeting
// creation (PR-3) and the rich debrief (PR-4) slot in later.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GraduationCap, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth, API_URL } from '@/hooks/useAuth';
import {
  mockApi, STATUS_LABEL,
  type MockRequest, type EligibleCandidate, type InterviewRef,
} from '@/lib/mockApi';

const LEAD_ROLES = new Set(['admin', 'lead', 'mlead', 'am', 'mam', 'teamlead', 'assistantmanager']);
const fmtEmail = (e: string) =>
  !e ? '' : e.split('@')[0].split(/[._]/).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
const fmtEst = (iso: string | null) =>
  !iso ? '' : new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' EST';

const STATUS_CLASS: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-600 border-emerald-400/40',
  cancelled: 'bg-muted text-muted-foreground border-border',
  recruiter_blocker: 'bg-rose-500/10 text-rose-600 border-rose-400/50',
  connected: 'bg-violet-500/10 text-violet-600 border-violet-400/40',
};
const statusClass = (s: string) => STATUS_CLASS[s] || 'bg-amber-500/10 text-amber-700 border-amber-400/40';

export default function MockSupports() {
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const role = (localStorage.getItem('role') || '').toLowerCase();
  const canCreate = LEAD_ROLES.has(role);

  const [mocks, setMocks] = useState<MockRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'mine' | 'open'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const qs = filter === 'mine' ? 'mine=true' : '';
      const { mocks: rows } = await mockApi.listMocks(authFetch, API_URL, qs);
      setMocks(filter === 'open' ? rows.filter((m) => !['completed', 'cancelled'].includes(m.status)) : rows);
    } catch (err) {
      toast({ title: 'Failed to load mocks', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [authFetch, filter, toast]);

  useEffect(() => { void reload(); }, [reload]);

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <GraduationCap className="h-6 w-6" /> Mock Supports
          </h1>
          <p className="text-sm text-muted-foreground">Request and run mock interviews — fully on the dashboard.</p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Request mock
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        {(['all', 'mine', 'open'] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'mine' ? 'My mocks' : 'Open'}
          </Button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : mocks.length === 0 ? (
        <div className="rounded-lg border bg-card py-16 text-center">
          <GraduationCap className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No mocks yet</p>
          <p className="text-sm text-muted-foreground">Requested mocks appear here.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mocks.map((m) => {
            const done = m.checklist.filter((c) => c.done).length;
            return (
              <button
                key={m._id}
                onClick={() => setDetailId(m._id)}
                className={`rounded-lg border p-4 text-left transition-colors hover:bg-muted/40 ${m.status === 'recruiter_blocker' ? 'border-rose-400/50' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{m.candidateName}</span>
                  <Badge variant="outline" className={`text-[10px] ${statusClass(m.status)}`}>{STATUS_LABEL[m.status]}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{m.role}{m.endClient ? ` · ${m.endClient}` : ''}</p>
                <p className="mt-1 text-xs text-muted-foreground">Expert: {fmtEmail(m.expertEmail)}</p>
                {m.scheduledAt && <p className="text-xs text-muted-foreground">Scheduled: {fmtEst(m.scheduledAt)}</p>}
                <p className="mt-2 text-[10px] text-muted-foreground">Checklist {done}/{m.checklist.length}{m.linkedTaskSnapshots.length ? ` · ${m.linkedTaskSnapshots.length} ref` : ''}</p>
              </button>
            );
          })}
        </div>
      )}

      {createOpen && (
        <CreateMockDrawer
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); void reload(); }}
        />
      )}
      {detailId && (
        <MockDetailDrawer
          mockId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={() => void reload()}
        />
      )}
    </div>
  );
}

// ── Create drawer ──────────────────────────────────────────────────────
function CreateMockDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const [candidates, setCandidates] = useState<EligibleCandidate[]>([]);
  const [candidateId, setCandidateId] = useState('');
  const [mockRole, setMockRole] = useState('');
  const [notes, setNotes] = useState('');
  const [interviews, setInterviews] = useState<InterviewRef[]>([]);
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    mockApi.eligibleCandidates(authFetch, API_URL)
      .then((r) => setCandidates(r.candidates || []))
      .catch(() => setCandidates([]));
  }, [open, authFetch]);

  const chosen = candidates.find((c) => c.candidateId === candidateId) || null;

  useEffect(() => {
    setLinkedIds(new Set());
    setInterviews([]);
    if (!chosen?.emailId) return;
    let cancelled = false;
    mockApi.candidateInterviews(authFetch, API_URL, chosen.emailId)
      .then((r) => { if (!cancelled) setInterviews(r.interviews || []); })
      .catch(() => { if (!cancelled) setInterviews([]); });
    return () => { cancelled = true; };
  }, [chosen?.emailId, authFetch]);

  const toggleRef = (id: string) => setLinkedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else if (next.size < 10) next.add(id);
    return next;
  });

  const submit = async () => {
    if (!candidateId) { toast({ title: 'Pick a candidate', variant: 'destructive' }); return; }
    setSubmitting(true);
    try {
      await mockApi.create(authFetch, API_URL, {
        candidateId,
        role: mockRole || chosen?.technology || '',
        linkedTaskIds: [...linkedIds],
        notes,
      });
      toast({ title: 'Mock requested', description: `${chosen?.name}'s expert has been notified.` });
      onCreated();
    } catch (err) {
      toast({ title: 'Request failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader><SheetTitle>Request a mock</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-4">
          <div>
            <Label className="text-xs">Candidate</Label>
            <Select value={candidateId || undefined} onValueChange={setCandidateId}>
              <SelectTrigger aria-label="Candidate"><SelectValue placeholder="Pick a candidate" /></SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.candidateId} value={c.candidateId}>
                    {c.name}{c.technology ? ` — ${c.technology}` : ''}{c.branch ? ` · ${c.branch}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {candidates.length === 0 && <p className="mt-1 text-xs text-muted-foreground">No candidates in your team’s bench.</p>}
          </div>

          {chosen && (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
              Expert (auto): <strong>{fmtEmail(chosen.expert)}</strong>
              {chosen.recruiter && <> · Recruiter: {fmtEmail(chosen.recruiter)}</>}
            </div>
          )}

          <div>
            <Label className="text-xs">Role / focus</Label>
            <Input value={mockRole} onChange={(e) => setMockRole(e.target.value)} placeholder={chosen?.technology || 'e.g. Data Engineer'} />
          </div>

          {interviews.length > 0 && (
            <div>
              <Label className="text-xs">Interview references (optional — based on these we mock)</Label>
              <div className="mt-1 max-h-44 space-y-1.5 overflow-y-auto rounded-md border p-2">
                {interviews.map((t) => (
                  <label key={t.taskId} className="flex cursor-pointer items-start gap-2 text-xs">
                    <Checkbox checked={linkedIds.has(t.taskId)} onCheckedChange={() => toggleRef(t.taskId)} aria-label={t.subject} />
                    <span className="min-w-0">
                      <span className="block truncate">{t.round || 'Interview'}{t.client ? ` · ${t.client}` : ''}</span>
                      <span className="block text-[10px] text-muted-foreground">{fmtEst(t.interviewStartAt)}{t.status ? ` · ${t.status}` : ''}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="What should the expert focus on?" />
          </div>

          <Button className="w-full" disabled={submitting || !candidateId} onClick={() => void submit()}>
            {submitting ? 'Requesting…' : 'Request mock'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Detail drawer ──────────────────────────────────────────────────────
function MockDetailDrawer({ mockId, onClose, onChanged }: { mockId: string; onClose: () => void; onChanged: () => void }) {
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const myEmail = (localStorage.getItem('email') || '').toLowerCase();
  const [mock, setMock] = useState<MockRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { mock: m } = await mockApi.getMock(authFetch, API_URL, mockId);
      setMock(m);
    } catch (err) {
      toast({ title: 'Failed to load', description: (err as Error).message, variant: 'destructive' });
      onClose();
    }
  }, [authFetch, mockId, toast, onClose]);

  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, okTitle: string) => {
    setBusy(true);
    try { await fn(); toast({ title: okTitle }); await load(); onChanged(); }
    catch (err) { toast({ title: 'Action failed', description: (err as Error).message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };

  const isExpert = mock && (myEmail === mock.expertEmail.toLowerCase() || mock.coExpertEmails.includes(myEmail));

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        {!mock ? <p className="p-4 text-sm text-muted-foreground">Loading…</p> : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {mock.candidateName}
                <Badge variant="outline" className={`text-[10px] ${statusClass(mock.status)}`}>{STATUS_LABEL[mock.status]}</Badge>
              </SheetTitle>
              <p className="text-xs text-muted-foreground">{mock.role}{mock.endClient ? ` · ${mock.endClient}` : ''} · Expert {fmtEmail(mock.expertEmail)}</p>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {mock.scheduledAt && <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">Scheduled: <strong>{fmtEst(mock.scheduledAt)}</strong></div>}

              {mock.linkedTaskSnapshots.length > 0 && (
                <div>
                  <Label className="text-xs">Interview references</Label>
                  <div className="mt-1 space-y-1">
                    {mock.linkedTaskSnapshots.map((t) => (
                      <div key={t.taskId} className="truncate rounded bg-muted/30 px-2 py-1 text-xs" title={t.subject}>
                        {t.subject || t.taskId}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Checklist */}
              <div>
                <Label className="text-xs">Checklist ({mock.checklist.filter((c) => c.done).length}/{mock.checklist.length})</Label>
                <div className="mt-1 space-y-1">
                  {mock.checklist.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={c.done}
                        disabled={!isExpert || busy}
                        onCheckedChange={(v) => void act(() => mockApi.toggleChecklist(authFetch, API_URL, mock._id, { itemId: c.id, done: v === true }), 'Updated')}
                        aria-label={c.label}
                      />
                      <span className={c.done ? 'text-muted-foreground line-through' : ''}>{c.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* One primary CTA per state */}
              {isExpert && <PrimaryCta mock={mock} busy={busy} act={act} authFetch={authFetch} />}

              {/* Recruiter unblock */}
              {mock.status === 'recruiter_blocker' && (
                <Button variant="outline" className="w-full" disabled={busy}
                  onClick={() => {
                    const note = window.prompt('Resolution note (e.g. "reached on WhatsApp, call after 8")') || '';
                    void act(() => mockApi.resolveBlocker(authFetch, API_URL, mock._id, { resolution: note }), 'Blocker resolved');
                  }}>
                  Resolve blocker → back to scheduling
                </Button>
              )}

              {mock.feedback && (
                <div className="rounded-md border p-3 text-sm">
                  <div className="font-medium">Feedback · {mock.feedback.overall}/5 · {mock.feedback.verdict.replace('_', ' ')}</div>
                  {mock.feedback.strengths && <p className="mt-1 text-xs"><strong>Strengths:</strong> {mock.feedback.strengths}</p>}
                  {mock.feedback.improvements && <p className="text-xs"><strong>Improve:</strong> {mock.feedback.improvements}</p>}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PrimaryCta({ mock, busy, act, authFetch }: {
  mock: MockRequest; busy: boolean;
  act: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const id = mock._id;
  switch (mock.status) {
    case 'requested':
      return <Button className="w-full" disabled={busy} onClick={() => void act(() => mockApi.start(authFetch, API_URL, id), 'Started')}>Start</Button>;
    case 'in_progress':
    case 'scheduling':
    case 'recruiter_blocker':
      return (
        <div className="space-y-2">
          <Button className="w-full" disabled={busy} onClick={() => {
            const note = window.prompt('Call outcome — type: reached / no_answer / rescheduled') || '';
            if (!['reached', 'no_answer', 'rescheduled'].includes(note)) return;
            let scheduledAt: string | undefined;
            if (note === 'reached') {
              const when = window.prompt('Agreed time (e.g. 2026-06-14 21:00 EST) — ISO or blank') || '';
              if (when) scheduledAt = new Date(when).toISOString();
            }
            void act(() => mockApi.callAttempt(authFetch, API_URL, id, { outcome: note, scheduledAt }), 'Call logged');
          }}>Log call attempt</Button>
          {mock.status !== 'recruiter_blocker' && (
            <Button variant="outline" className="w-full" disabled={busy} onClick={() => {
              const note = window.prompt('Why is the candidate unreachable?') || '';
              void act(() => mockApi.raiseBlocker(authFetch, API_URL, id, { note }), 'Blocker raised');
            }}>Candidate unreachable → recruiter</Button>
          )}
        </div>
      );
    case 'scheduled':
      // meeting creation is PR-3; until then expert marks connected directly
      return <Button className="w-full" disabled={busy} onClick={() => void act(() => mockApi.markConnected(authFetch, API_URL, id), 'Marked connected')}>Mark connected</Button>;
    case 'meeting_created':
      return <Button className="w-full" disabled={busy} onClick={() => void act(() => mockApi.markConnected(authFetch, API_URL, id), 'Marked connected')}>Mark connected</Button>;
    case 'connected':
      return (
        <Button className="w-full" disabled={busy} onClick={() => {
          const overall = Number(window.prompt('Overall 1–5') || '');
          const verdict = window.prompt('Verdict: ready / needs_practice / not_ready') || '';
          const strengths = window.prompt('Strengths (optional)') || '';
          const improvements = window.prompt('Improvements (optional)') || '';
          if (!(overall >= 1 && overall <= 5) || !['ready', 'needs_practice', 'not_ready'].includes(verdict)) return;
          void act(() => mockApi.submitFeedback(authFetch, API_URL, id, { overall, verdict, strengths, improvements }), 'Feedback submitted');
        }}>Submit feedback & complete</Button>
      );
    default:
      return null;
  }
}
