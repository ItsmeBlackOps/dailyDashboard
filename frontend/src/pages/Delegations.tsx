// C19 UI — standalone Delegations page.
//
// Three sections:
//   1. New Share — grant a peer access to a subordinate / subtree
//   2. New Transfer — one-shot lateral move
//   3. My Active Shares — outbound (owned) + inbound (delegated to me),
//      with revoke action per row
//
// The page is intentionally minimal — most of the validation lives on
// the backend (share matrix, authority, compatibility). This UI just
// collects intent + surfaces errors clearly.

import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth, API_URL } from '@/hooks/useAuth';
import {
  Delegation, MineResponse, fetchMineDelegations, grantDelegation,
  revokeDelegation, transferUser, TTL_OPTIONS,
} from '@/lib/delegationApi';

const formatExpiry = (d: Delegation): string => {
  if (!d.expiresAt) return 'Forever';
  const now = Date.now();
  const exp = new Date(d.expiresAt).getTime();
  if (exp < now) return 'Expired';
  const days = Math.ceil((exp - now) / (24 * 60 * 60 * 1000));
  return `${days} day${days === 1 ? '' : 's'} left (${new Date(d.expiresAt).toLocaleDateString()})`;
};

export default function DelegationsPage() {
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const myEmail = (localStorage.getItem('email') || '').toLowerCase();

  const [mine, setMine] = useState<MineResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Grant form state
  const [delegateEmail, setDelegateEmail] = useState('');
  const [scope, setScope] = useState<'subtree' | 'specific'>('subtree');
  const [subjectEmailsRaw, setSubjectEmailsRaw] = useState('');
  const [subtreeRoot, setSubtreeRoot] = useState(''); // defaults to self below
  const [ttlDays, setTtlDays] = useState<string>('7'); // string for Select compat
  const [reason, setReason] = useState('');
  const [granting, setGranting] = useState(false);

  // Transfer form state
  const [transferSubject, setTransferSubject] = useState('');
  const [transferTo, setTransferTo] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferring, setTransferring] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await fetchMineDelegations(authFetch, API_URL);
      setMine(data);
    } catch (err) {
      toast({
        title: 'Failed to load delegations',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    if (!subtreeRoot && myEmail) setSubtreeRoot(myEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGrant = async () => {
    if (!delegateEmail) {
      toast({ title: 'Pick a delegate', description: 'Enter an email.', variant: 'destructive' });
      return;
    }
    setGranting(true);
    try {
      const subjectEmails = scope === 'specific'
        ? subjectEmailsRaw.split(/[,\s]+/).map((e) => e.trim()).filter(Boolean)
        : undefined;
      await grantDelegation(authFetch, API_URL, {
        delegateEmail: delegateEmail.trim().toLowerCase(),
        scope,
        subjectEmails,
        subtreeRootEmail: scope === 'subtree' ? (subtreeRoot || myEmail) : null,
        ttlDays: ttlDays === 'forever' ? null : parseInt(ttlDays, 10),
        reason: reason.trim() || undefined,
      });
      toast({ title: 'Share granted' });
      setDelegateEmail('');
      setSubjectEmailsRaw('');
      setReason('');
      await reload();
    } catch (err) {
      toast({
        title: 'Grant failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setGranting(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!window.confirm('Revoke this share?')) return;
    try {
      await revokeDelegation(authFetch, API_URL, id, 'manual revoke from UI');
      toast({ title: 'Share revoked' });
      await reload();
    } catch (err) {
      toast({
        title: 'Revoke failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleTransfer = async () => {
    if (!transferSubject || !transferTo) {
      toast({ title: 'Need subject + new teamLead', variant: 'destructive' });
      return;
    }
    if (!window.confirm(`Move ${transferSubject} to teamLead "${transferTo}"? The current teamLead loses access immediately.`)) return;
    setTransferring(true);
    try {
      await transferUser(authFetch, API_URL, {
        subjectEmail: transferSubject.trim().toLowerCase(),
        toTeamLeadDisplayName: transferTo.trim(),
        reason: transferReason.trim() || undefined,
      });
      toast({ title: 'Transfer applied' });
      setTransferSubject('');
      setTransferTo('');
      setTransferReason('');
    } catch (err) {
      toast({
        title: 'Transfer failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setTransferring(false);
    }
  };

  const ownedSorted = useMemo(
    () => (mine?.owned || []).slice().sort((a, b) => (b.grantedAt || '').localeCompare(a.grantedAt || '')),
    [mine],
  );
  const delegatedSorted = useMemo(
    () => (mine?.delegated || []).slice().sort((a, b) => (b.grantedAt || '').localeCompare(a.grantedAt || '')),
    [mine],
  );

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold">Delegations</h1>
          <p className="text-sm text-muted-foreground">
            Share access to your subordinates with a peer (time-bound), or transfer a report to a peer's team.
            Original ownership is unchanged for shares; transfers move the reporting line one-shot.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New Share</CardTitle>
              <CardDescription>Grant a peer time-bound access to your reports.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Delegate email</Label>
                <Input value={delegateEmail} onChange={(e) => setDelegateEmail(e.target.value)} placeholder="peer@silverspaceinc.com" />
              </div>
              <div>
                <Label className="text-xs">Scope</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as 'subtree' | 'specific')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="subtree">Subtree — covers everyone under a root, including future hires</SelectItem>
                    <SelectItem value="specific">Specific — exact list of subordinate emails</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {scope === 'subtree' && (
                <div>
                  <Label className="text-xs">Subtree root email</Label>
                  <Input value={subtreeRoot} onChange={(e) => setSubtreeRoot(e.target.value)} placeholder={myEmail} />
                  <p className="text-xs text-muted-foreground mt-1">Defaults to you. Use a sub-root to share only part of your subtree.</p>
                </div>
              )}
              {scope === 'specific' && (
                <div>
                  <Label className="text-xs">Subject emails</Label>
                  <Input value={subjectEmailsRaw} onChange={(e) => setSubjectEmailsRaw(e.target.value)} placeholder="a@x.com, b@x.com" />
                  <p className="text-xs text-muted-foreground mt-1">Comma- or space-separated.</p>
                </div>
              )}
              <div>
                <Label className="text-xs">Duration</Label>
                <Select value={ttlDays} onValueChange={setTtlDays}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TTL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.label} value={opt.days === null ? 'forever' : String(opt.days)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Reason (optional)</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="PTO 7d, handoff, etc." />
              </div>
              <Button onClick={handleGrant} disabled={granting} className="w-full">
                {granting ? 'Granting…' : 'Grant share'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transfer to peer</CardTitle>
              <CardDescription>One-shot lateral move. Source loses access immediately.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Subject email</Label>
                <Input value={transferSubject} onChange={(e) => setTransferSubject(e.target.value)} placeholder="user@x.com" />
              </div>
              <div>
                <Label className="text-xs">New teamLead (display name)</Label>
                <Input value={transferTo} onChange={(e) => setTransferTo(e.target.value)} placeholder="e.g. Umang Pandya" />
                <p className="text-xs text-muted-foreground mt-1">
                  Match the existing teamLead string format exactly. The C9/C16 validator will reject invalid combinations.
                </p>
              </div>
              <div>
                <Label className="text-xs">Reason (optional)</Label>
                <Input value={transferReason} onChange={(e) => setTransferReason(e.target.value)} />
              </div>
              <Button onClick={handleTransfer} disabled={transferring} className="w-full">
                {transferring ? 'Moving…' : 'Apply transfer'}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">My Active Shares</CardTitle>
            <CardDescription>
              {loading ? 'Loading…' : `${ownedSorted.length} outbound, ${delegatedSorted.length} inbound`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold mb-2">Outbound — shares I have granted</h3>
              {ownedSorted.length === 0 ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Delegate</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead className="w-32" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ownedSorted.map((d) => (
                      <TableRow key={d._id}>
                        <TableCell className="font-mono text-xs">{d.delegateEmail}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{d.scope}</Badge>
                          {d.scope === 'subtree' && d.subtreeRootEmail && (
                            <span className="ml-2 text-xs text-muted-foreground">root: {d.subtreeRootEmail}</span>
                          )}
                          {d.scope === 'specific' && (
                            <span className="ml-2 text-xs text-muted-foreground">{d.subjectEmails.length} subject(s)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{formatExpiry(d)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{d.reason || '—'}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => handleRevoke(d._id)}>Revoke</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2">Inbound — shares granted to me</h3>
              {delegatedSorted.length === 0 ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Owner</TableHead>
                      <TableHead>Scope</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {delegatedSorted.map((d) => (
                      <TableRow key={d._id}>
                        <TableCell className="font-mono text-xs">{d.ownerEmail}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{d.scope}</Badge>
                          {d.scope === 'subtree' && d.subtreeRootEmail && (
                            <span className="ml-2 text-xs text-muted-foreground">root: {d.subtreeRootEmail}</span>
                          )}
                          {d.scope === 'specific' && (
                            <span className="ml-2 text-xs text-muted-foreground">{d.subjectEmails.length} subject(s)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{formatExpiry(d)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{d.reason || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
