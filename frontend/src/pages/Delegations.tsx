// Delegations — coverage & hand-offs (2026-06-12 redesign).
//
// Everything is dropdown-driven from GET /api/delegations/eligible (the
// server computes who is legal via the same rules that validate writes),
// values are prefilled, and a live summary sentence states exactly what
// will happen before anything is committed.
//
// Role-shaped surface:
//   expert (user/expert)  "Share my work" — a whole day or a dashboard
//                         window to a same-team teammate; lands PENDING
//                         until their own team lead approves.
//   lead and above        direct C19 share (team / specific people, TTL
//                         chips), the "Awaiting your approval" inbox for
//                         expert requests, and lateral Transfer — now with
//                         people pickers instead of free-typed emails.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { deriveDisplayNameFromEmail } from '@/utils/userNames';
import {
  Delegation, MineResponse, EligibleResponse, PendingApprovalsResponse,
  fetchMineDelegations, fetchEligible, fetchPendingApprovals,
  grantDelegation, approveDelegation, rejectDelegation, revokeDelegation,
  transferUser, describeDelegation,
} from '@/lib/delegationApi';
import {
  approveCoAssignee, rejectCoAssignee, fetchPendingCoAssigns,
  type PendingCoAssignItem,
} from '@/lib/coAssignApi';

const EXPERT_ROLES = new Set(['user', 'expert']);
const TTL_CHIP_DAYS = [7, 15, 30, 180];

const nameOf = (email?: string | null): string =>
  email ? deriveDisplayNameFromEmail(email) || email : '';

const todayISO = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const formatExpiry = (d: Delegation): string => {
  if (!d.expiresAt) return 'No expiry';
  const exp = new Date(d.expiresAt).getTime();
  const now = Date.now();
  if (exp < now) return 'Expired';
  const days = Math.ceil((exp - now) / (24 * 60 * 60 * 1000));
  return `${days} day${days === 1 ? '' : 's'} left (${new Date(d.expiresAt).toLocaleDateString()})`;
};

function StatusChip({ d }: { d: Delegation }) {
  const status = d.status || 'active';
  if (status === 'pending') {
    return (
      <Badge variant="outline" className="border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px]">
        pending approval
      </Badge>
    );
  }
  if (status === 'rejected') {
    return (
      <Badge variant="outline" className="border-rose-400/60 bg-rose-500/10 text-rose-600 text-[10px]">
        declined
      </Badge>
    );
  }
  const dormant = d.startsAt && new Date(d.startsAt).getTime() > Date.now();
  return (
    <Badge variant="outline" className="border-emerald-400/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px]">
      {dormant ? `starts ${new Date(d.startsAt as string).toLocaleDateString()}` : 'active'}
    </Badge>
  );
}

export default function DelegationsPage() {
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const myEmail = (localStorage.getItem('email') || '').toLowerCase();
  const myRole = (localStorage.getItem('role') || '').toLowerCase();
  const isExpert = EXPERT_ROLES.has(myRole);
  const isAdmin = myRole === 'admin';

  const [mine, setMine] = useState<MineResponse | null>(null);
  const [eligible, setEligible] = useState<EligibleResponse | null>(null);
  const [pending, setPending] = useState<PendingApprovalsResponse | null>(null);
  const [coAssignInbox, setCoAssignInbox] = useState<PendingCoAssignItem[]>([]);
  const [loading, setLoading] = useState(true);

  // ── shared form state ────────────────────────────────────────────────
  const [delegateEmail, setDelegateEmail] = useState('');
  const [reason, setReason] = useState('');
  const [granting, setGranting] = useState(false);

  // expert form
  const [coverageType, setCoverageType] = useState<'day' | 'window'>('day');
  const [dayDate, setDayDate] = useState(todayISO());
  const [windowFrom, setWindowFrom] = useState(todayISO());
  const [windowTo, setWindowTo] = useState('');

  // lead form
  const [scopeChoice, setScopeChoice] = useState<'team' | 'specific'>('team');
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(new Set());
  const [ttlDays, setTtlDays] = useState<number | null>(7);

  // transfer form
  const [transferSubject, setTransferSubject] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferring, setTransferring] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [m, e, p, ca] = await Promise.all([
        fetchMineDelegations(authFetch, API_URL),
        fetchEligible(authFetch, API_URL),
        fetchPendingApprovals(authFetch, API_URL),
        fetchPendingCoAssigns(authFetch, API_URL).catch(() => ({ success: false, items: [] })),
      ]);
      setMine(m);
      setEligible(e);
      setPending(p);
      setCoAssignInbox(ca.items || []);
    } catch (err) {
      toast({
        title: 'Failed to load delegations',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [authFetch, toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const delegateName = nameOf(delegateEmail);

  // ── summary sentences (the "what will happen" line) ─────────────────
  const expertSummary = useMemo(() => {
    if (!delegateEmail) return '';
    if (coverageType === 'day') {
      return `${delegateName} will see all your tasks on ${dayDate || '…'} — needs your team lead's approval.`;
    }
    if (!windowTo) return `Pick an end date for the window.`;
    return `${delegateName} will see your whole dashboard from ${windowFrom} to ${windowTo} — needs your team lead's approval.`;
  }, [delegateEmail, delegateName, coverageType, dayDate, windowFrom, windowTo]);

  const leadSummary = useMemo(() => {
    if (!delegateEmail) return '';
    const what = scopeChoice === 'team'
      ? 'everyone under you'
      : `${selectedPeople.size} selected ${selectedPeople.size === 1 ? 'person' : 'people'}`;
    const when = ttlDays === null ? 'with no expiry' : `for ${ttlDays} days`;
    return `${delegateName} will see ${what} ${when}.`;
  }, [delegateEmail, delegateName, scopeChoice, selectedPeople, ttlDays]);

  // ── actions ──────────────────────────────────────────────────────────
  const resetShareForm = () => {
    setDelegateEmail('');
    setReason('');
    setSelectedPeople(new Set());
    setWindowTo('');
  };

  const handleExpertGrant = async () => {
    if (!delegateEmail) {
      toast({ title: 'Pick a teammate', variant: 'destructive' });
      return;
    }
    setGranting(true);
    try {
      if (coverageType === 'day') {
        await grantDelegation(authFetch, API_URL, {
          delegateEmail, scope: 'day', dayDate, reason: reason.trim() || undefined,
        });
      } else {
        await grantDelegation(authFetch, API_URL, {
          delegateEmail,
          scope: 'subtree',
          subtreeRootEmail: myEmail,
          startsAt: windowFrom ? new Date(`${windowFrom}T00:00:00`).toISOString() : undefined,
          endsAt: windowTo ? new Date(`${windowTo}T23:59:59`).toISOString() : undefined,
          reason: reason.trim() || undefined,
        });
      }
      toast({
        title: 'Request sent for approval',
        description: 'Your team lead has been notified — coverage starts once they approve.',
      });
      resetShareForm();
      await reload();
    } catch (err) {
      toast({ title: 'Request failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setGranting(false);
    }
  };

  const handleLeadGrant = async () => {
    if (!delegateEmail) {
      toast({ title: 'Pick a delegate', variant: 'destructive' });
      return;
    }
    if (scopeChoice === 'specific' && selectedPeople.size === 0) {
      toast({ title: 'Select at least one person', variant: 'destructive' });
      return;
    }
    setGranting(true);
    try {
      await grantDelegation(authFetch, API_URL, {
        delegateEmail,
        scope: scopeChoice === 'team' ? 'subtree' : 'specific',
        subtreeRootEmail: scopeChoice === 'team' ? myEmail : undefined,
        subjectEmails: scopeChoice === 'specific' ? [...selectedPeople] : undefined,
        ttlDays,
        reason: reason.trim() || undefined,
      });
      toast({ title: 'Share granted' });
      resetShareForm();
      await reload();
    } catch (err) {
      toast({ title: 'Grant failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setGranting(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await approveDelegation(authFetch, API_URL, id);
      toast({ title: 'Approved', description: 'The coverage is now active.' });
      await reload();
    } catch (err) {
      toast({ title: 'Approve failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleReject = async (id: string) => {
    const note = window.prompt('Optional note for the requester (or leave empty):') || '';
    try {
      await rejectDelegation(authFetch, API_URL, id, note);
      toast({ title: 'Request declined' });
      await reload();
    } catch (err) {
      toast({ title: 'Reject failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleRevoke = async (d: Delegation) => {
    const verb = (d.status || 'active') === 'pending' ? 'Cancel this request?' : 'Revoke this share?';
    if (!window.confirm(verb)) return;
    try {
      await revokeDelegation(authFetch, API_URL, d._id, 'manual revoke from UI');
      toast({ title: (d.status || 'active') === 'pending' ? 'Request cancelled' : 'Share revoked' });
      await reload();
    } catch (err) {
      toast({ title: 'Revoke failed', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleTransfer = async () => {
    if (!transferSubject || !transferTo) {
      toast({ title: 'Pick a person and a destination lead', variant: 'destructive' });
      return;
    }
    const subjectName = nameOf(transferSubject);
    if (!window.confirm(`Move ${subjectName} under "${transferTo}" permanently? Their current lead loses access immediately.`)) return;
    setTransferring(true);
    try {
      await transferUser(authFetch, API_URL, {
        subjectEmail: transferSubject,
        toTeamLeadDisplayName: transferTo,
        reason: transferReason.trim() || undefined,
      });
      toast({ title: 'Transfer applied' });
      setTransferSubject('');
      setTransferTo('');
      setTransferReason('');
      await reload();
    } catch (err) {
      toast({ title: 'Transfer failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setTransferring(false);
    }
  };

  // ── derived lists ────────────────────────────────────────────────────
  const waitingOnMe = pending?.waitingOnMe || [];
  const inboxCount = waitingOnMe.length + coAssignInbox.length;
  const ownedAll = useMemo(() => {
    const pendingOwned = mine?.pendingOwned || [];
    const owned = mine?.owned || [];
    return [...pendingOwned, ...owned].sort((a, b) => (b.grantedAt || '').localeCompare(a.grantedAt || ''));
  }, [mine]);
  const delegatedSorted = useMemo(
    () => (mine?.delegated || []).slice().sort((a, b) => (b.grantedAt || '').localeCompare(a.grantedAt || '')),
    [mine],
  );

  const togglePerson = (email: string) => {
    setSelectedPeople((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Delegations</h1>
        <p className="text-sm text-muted-foreground">
          {isExpert
            ? 'Going on leave or double-booked? Share your work with a teammate — your team lead approves it.'
            : 'Share access with a peer for a while, approve your experts’ coverage requests, or transfer a report permanently.'}
        </p>
      </div>

      {/* ── Awaiting your approval (leads/admin) ── */}
      {inboxCount > 0 && (
        <Card className="border-amber-400/60">
          <CardHeader>
            <CardTitle className="text-base">Awaiting your approval ({inboxCount})</CardTitle>
            <CardDescription>Coverage requests and co-expert adds from your experts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {waitingOnMe.map((d) => (
              <div key={d._id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-amber-500/[0.04] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {nameOf(d.ownerEmail)} → {nameOf(d.delegateEmail)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {describeDelegation(d)}
                    {d.startsAt ? ` · from ${new Date(d.startsAt).toLocaleDateString()}` : ''}
                    {d.expiresAt ? ` · until ${new Date(d.expiresAt).toLocaleDateString()}` : ''}
                    {d.reason ? ` · "${d.reason}"` : ''}
                  </div>
                </div>
                <Button size="sm" onClick={() => void handleApprove(d._id)}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => void handleReject(d._id)}>Reject</Button>
              </div>
            ))}
            {coAssignInbox.map((c) => (
              <div key={`${c.taskId}-${c.email}`} className="flex flex-wrap items-center gap-3 rounded-lg border bg-amber-500/[0.04] px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {nameOf(c.requestedBy)} wants {nameOf(c.email)} as co-expert
                  </div>
                  <div className="truncate text-xs text-muted-foreground" title={c.subject}>
                    {c.subject}
                  </div>
                </div>
                <Button size="sm" onClick={() => void (async () => {
                  try {
                    await approveCoAssignee(authFetch, API_URL, c.taskId, c.email);
                    toast({ title: 'Co-expert approved' });
                    await reload();
                  } catch (err) {
                    toast({ title: 'Approve failed', description: (err as Error).message, variant: 'destructive' });
                  }
                })()}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => void (async () => {
                  const note = window.prompt('Optional note for the requester (or leave empty):') || '';
                  try {
                    await rejectCoAssignee(authFetch, API_URL, c.taskId, c.email, note);
                    toast({ title: 'Request declined' });
                    await reload();
                  } catch (err) {
                    toast({ title: 'Reject failed', description: (err as Error).message, variant: 'destructive' });
                  }
                })()}>Reject</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* ── Share card ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{isExpert ? 'Share my work' : 'New share'}</CardTitle>
            <CardDescription>
              {isExpert
                ? 'A teammate covers your tasks for a day, or your whole dashboard for a date range.'
                : 'Grant a peer time-bound access to your people.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">{isExpert ? 'Who covers for you?' : 'Who gets access?'}</Label>
              <Select value={delegateEmail || undefined} onValueChange={setDelegateEmail}>
                <SelectTrigger aria-label={isExpert ? 'Teammate' : 'Delegate'}>
                  <SelectValue placeholder={isExpert ? 'Pick a teammate' : 'Pick a peer'} />
                </SelectTrigger>
                <SelectContent>
                  {(eligible?.delegates || []).map((p) => (
                    <SelectItem key={p.email} value={p.email}>
                      {nameOf(p.email)}
                      {p.teamLead ? ` — under ${p.teamLead}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loading && (eligible?.delegates || []).length === 0 && (
                <p className="mt-1 text-xs text-muted-foreground">No eligible people found for your role.</p>
              )}
            </div>

            {isExpert ? (
              <>
                <div>
                  <Label className="text-xs">What do they cover?</Label>
                  <div className="mt-1 flex gap-2">
                    <Button
                      type="button" size="sm"
                      variant={coverageType === 'day' ? 'default' : 'outline'}
                      onClick={() => setCoverageType('day')}
                    >
                      One day
                    </Button>
                    <Button
                      type="button" size="sm"
                      variant={coverageType === 'window' ? 'default' : 'outline'}
                      onClick={() => setCoverageType('window')}
                    >
                      My dashboard (date range)
                    </Button>
                  </div>
                </div>
                {coverageType === 'day' ? (
                  <div>
                    <Label className="text-xs">Which day?</Label>
                    <Input type="date" aria-label="Which day" value={dayDate} onChange={(e) => setDayDate(e.target.value)} />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">From</Label>
                      <Input type="date" aria-label="From" value={windowFrom} onChange={(e) => setWindowFrom(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">To (max 30 days)</Label>
                      <Input type="date" aria-label="To (max 30 days)" value={windowTo} onChange={(e) => setWindowTo(e.target.value)} />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <Label className="text-xs">What can they see?</Label>
                  <div className="mt-1 flex gap-2">
                    <Button
                      type="button" size="sm"
                      variant={scopeChoice === 'team' ? 'default' : 'outline'}
                      onClick={() => setScopeChoice('team')}
                    >
                      My whole team
                    </Button>
                    <Button
                      type="button" size="sm"
                      variant={scopeChoice === 'specific' ? 'default' : 'outline'}
                      onClick={() => setScopeChoice('specific')}
                    >
                      Only specific people
                    </Button>
                  </div>
                </div>
                {scopeChoice === 'specific' && (
                  <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-md border p-2">
                    {(eligible?.myPeople || []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">No direct reports found.</p>
                    ) : (
                      (eligible?.myPeople || []).map((p) => (
                        <label key={p.email} className="flex cursor-pointer items-center gap-2 text-sm">
                          <Checkbox
                            checked={selectedPeople.has(p.email)}
                            onCheckedChange={() => togglePerson(p.email)}
                            aria-label={nameOf(p.email)}
                          />
                          <span>{nameOf(p.email)}</span>
                          <span className="text-xs text-muted-foreground">{p.role}</span>
                        </label>
                      ))
                    )}
                  </div>
                )}
                <div>
                  <Label className="text-xs">For how long?</Label>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {TTL_CHIP_DAYS.map((d) => (
                      <Button
                        key={d} type="button" size="sm"
                        variant={ttlDays === d ? 'default' : 'outline'}
                        onClick={() => setTtlDays(d)}
                      >
                        {d} days
                      </Button>
                    ))}
                    {isAdmin && (
                      <Button
                        type="button" size="sm"
                        variant={ttlDays === null ? 'default' : 'outline'}
                        onClick={() => setTtlDays(null)}
                      >
                        Forever
                      </Button>
                    )}
                  </div>
                </div>
              </>
            )}

            <div>
              <Label className="text-xs">Reason (shows in the audit trail)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={isExpert ? 'annual leave, double-booked…' : 'PTO cover, handoff…'} />
            </div>

            {(isExpert ? expertSummary : leadSummary) && (
              <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-foreground/80">
                {isExpert ? expertSummary : leadSummary}
              </p>
            )}

            <Button
              onClick={() => void (isExpert ? handleExpertGrant() : handleLeadGrant())}
              disabled={granting}
              className="w-full"
            >
              {granting ? 'Sending…' : isExpert ? 'Request coverage' : 'Grant share'}
            </Button>
          </CardContent>
        </Card>

        {/* ── Transfer card (leads/admin only) ── */}
        {!isExpert && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transfer to a peer</CardTitle>
              <CardDescription>Permanent lateral move — the current lead loses access immediately.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Who moves?</Label>
                <Select value={transferSubject || undefined} onValueChange={setTransferSubject}>
                  <SelectTrigger aria-label="Transfer subject">
                    <SelectValue placeholder="Pick one of your people" />
                  </SelectTrigger>
                  <SelectContent>
                    {(eligible?.myPeople || []).map((p) => (
                      <SelectItem key={p.email} value={p.email}>
                        {nameOf(p.email)} <span className="text-muted-foreground">({p.role})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">To which lead?</Label>
                <Select value={transferTo || undefined} onValueChange={setTransferTo}>
                  <SelectTrigger aria-label="Destination lead">
                    <SelectValue placeholder="Pick the receiving lead" />
                  </SelectTrigger>
                  <SelectContent>
                    {(eligible?.transferTargets || []).map((t) => (
                      <SelectItem key={t.email} value={t.displayName}>
                        {t.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Reason (optional)</Label>
                <Input value={transferReason} onChange={(e) => setTransferReason(e.target.value)} />
              </div>
              {transferSubject && transferTo && (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-foreground/80">
                  {nameOf(transferSubject)} will move under {transferTo} permanently.
                </p>
              )}
              <Button onClick={() => void handleTransfer()} disabled={transferring} className="w-full">
                {transferring ? 'Moving…' : 'Apply transfer'}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── My shares ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">My shares</CardTitle>
          <CardDescription>
            {loading ? 'Loading…' : `${ownedAll.length} outbound · ${delegatedSorted.length} covering for others`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Outbound — what I have shared</h3>
            {ownedAll.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing shared right now.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>To</TableHead>
                    <TableHead>Covers</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="w-32" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ownedAll.map((d) => (
                    <TableRow key={d._id}>
                      <TableCell className="text-sm">{nameOf(d.delegateEmail)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {describeDelegation(d, myEmail)}
                        {d.reason ? ` · "${d.reason}"` : ''}
                      </TableCell>
                      <TableCell><StatusChip d={d} /></TableCell>
                      <TableCell className="text-xs">{formatExpiry(d)}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => void handleRevoke(d)}>
                          {(d.status || 'active') === 'pending' ? 'Cancel' : 'Revoke'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Inbound — what others shared with me</h3>
            {delegatedSorted.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody is sharing with you right now.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>From</TableHead>
                    <TableHead>Covers</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expires</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {delegatedSorted.map((d) => (
                    <TableRow key={d._id}>
                      <TableCell className="text-sm">{nameOf(d.ownerEmail)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{describeDelegation(d)}</TableCell>
                      <TableCell><StatusChip d={d} /></TableCell>
                      <TableCell className="text-xs">{formatExpiry(d)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
