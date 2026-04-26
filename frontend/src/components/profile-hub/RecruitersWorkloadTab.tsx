import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useHubFetch } from './useHubApi';
import { statusColors, type CandidateStatus } from './mockData';
import { API_URL, requestRefreshToken } from '@/hooks/useAuth';

// ── types ─────────────────────────────────────────────────────────────────────

type WorkloadStatus = 'overloaded' | 'optimal' | 'underutilized';
type SortKey = 'performance' | 'workload' | 'name';

interface RecruiterBase {
  email: string;
  name: string;
  total: number;
  active: number;
  po: number;
  hold: number;
  backout: number;
}

interface RecruiterWorkload {
  email: string;
  name: string;
  activeCount: number;
  totalCount: number;
  capacity: number;
  workloadRatio: number;
  workloadStatus: WorkloadStatus;
}

interface MergedRecruiter extends RecruiterBase {
  capacity: number;
  workloadRatio: number;
  workloadStatus: WorkloadStatus;
  isCurrentUser?: boolean;
}

interface WorkloadConfig {
  defaultCapacity: number;
  capacities: Record<string, number>;
}

interface WorkloadResponse {
  success: boolean;
  config: WorkloadConfig;
  recruiters: RecruiterWorkload[];
}

interface HubRecruiters {
  recruiters: RecruiterBase[];
}

interface CandidateRow {
  id: string;
  name: string;
  technology: string;
  branch: string;
  recruiter: string;
  status: string;
  updatedAt: string | null;
  poDate?: string | null;
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function hubFetch(
  url: string,
  navigate: ReturnType<typeof useNavigate>,
  options?: RequestInit,
): Promise<Response> {
  const doFetch = (token: string) =>
    fetch(url, {
      ...options,
      headers: { ...(options?.headers ?? {}), Authorization: `Bearer ${token}` },
    });

  let token = localStorage.getItem('accessToken') || '';
  let res = await doFetch(token);

  if (res.status === 401) {
    const refreshToken = localStorage.getItem('refreshToken') || '';
    const newToken = refreshToken ? await requestRefreshToken(refreshToken) : null;
    if (!newToken) {
      navigate('/auth/signin');
      throw new Error('Unauthorized');
    }
    localStorage.setItem('accessToken', newToken);
    res = await doFetch(newToken);
  }

  return res;
}

const STATUS_CONFIG: Record<
  WorkloadStatus,
  { label: string; textColor: string; barColor: string; bgColor: string; borderColor: string; badgeClass: string }
> = {
  overloaded: {
    label: 'OVERLOADED',
    textColor: 'text-destructive',
    barColor: 'bg-destructive',
    bgColor: 'bg-destructive/10',
    borderColor: 'border-destructive/30',
    badgeClass: 'bg-destructive/15 text-destructive border-destructive/30',
  },
  optimal: {
    label: 'OPTIMAL',
    textColor: 'text-aurora-emerald',
    barColor: 'bg-aurora-emerald',
    bgColor: 'bg-aurora-emerald/10',
    borderColor: 'border-aurora-emerald/30',
    badgeClass: 'bg-aurora-emerald/15 text-aurora-emerald border-aurora-emerald/30',
  },
  underutilized: {
    label: 'UNDERUTILIZED',
    textColor: 'text-aurora-cyan',
    barColor: 'bg-aurora-cyan',
    bgColor: 'bg-aurora-cyan/10',
    borderColor: 'border-aurora-cyan/30',
    badgeClass: 'bg-aurora-cyan/15 text-aurora-cyan border-aurora-cyan/30',
  },
};

const STATUSES: CandidateStatus[] = ['Active', 'Placement Offer', 'Hold', 'Backout', 'Low Priority', 'Unassigned'];

function StatBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-1.5 rounded bg-muted overflow-hidden flex-1">
      <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function daysAgo(d: string | null) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

// ── component ─────────────────────────────────────────────────────────────────

export default function RecruitersWorkloadTab() {
  const navigate = useNavigate();
  const role = (localStorage.getItem('role') || '').toLowerCase();
  const isAdmin = role === 'admin';
  const currentEmail = (localStorage.getItem('email') || '').toLowerCase();

  // data state
  const { data: recData, loading: recLoading, error: recError } = useHubFetch<HubRecruiters>('hub-recruiters');
  const [workloadData, setWorkloadData] = useState<WorkloadResponse | null>(null);
  const [workloadLoading, setWorkloadLoading] = useState(true);
  const [workloadError, setWorkloadError] = useState<string | null>(null);

  // sort + merged list
  const [sortBy, setSortBy] = useState<SortKey>('performance');
  const [merged, setMerged] = useState<MergedRecruiter[]>([]);

  // recruiter drill-down dialog
  const [selected, setSelected] = useState<MergedRecruiter | null>(null);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [candTotal, setCandTotal] = useState(0);
  const [candLoading, setCandLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  // admin capacity editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [defaultCapacity, setDefaultCapacity] = useState(10);
  const [capacityOverrides, setCapacityOverrides] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // fetch workload data
  const fetchWorkload = useCallback(async () => {
    setWorkloadLoading(true);
    setWorkloadError(null);
    try {
      const res = await hubFetch(`${API_URL}/api/candidates/hub-workload`, navigate);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: WorkloadResponse = await res.json();
      if (!json.success) throw new Error('Request failed');
      setWorkloadData(json);
      if (json.config) {
        setDefaultCapacity(json.config.defaultCapacity ?? 10);
        setCapacityOverrides(json.config.capacities ?? {});
      }
    } catch (e) {
      setWorkloadError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setWorkloadLoading(false);
    }
  }, [navigate]);

  useEffect(() => { fetchWorkload(); }, [fetchWorkload]);

  // merge rec + workload data
  useEffect(() => {
    if (!recData || !workloadData) return;

    const workloadMap = new Map<string, RecruiterWorkload>(
      workloadData.recruiters.map(w => [w.email.toLowerCase(), w]),
    );

    const list: MergedRecruiter[] = recData.recruiters.map(r => {
      const w = workloadMap.get(r.email.toLowerCase());
      return {
        ...r,
        capacity: w?.capacity ?? defaultCapacity,
        workloadRatio: w?.workloadRatio ?? 0,
        workloadStatus: w?.workloadStatus ?? 'underutilized',
      };
    });

    // inject current user card if not present
    if (currentEmail && !list.find(r => r.email.toLowerCase() === currentEmail)) {
      const w = workloadMap.get(currentEmail);
      list.unshift({
        email: currentEmail,
        name: localStorage.getItem('name') || 'You',
        total: 0,
        active: 0,
        po: 0,
        hold: 0,
        backout: 0,
        capacity: w?.capacity ?? defaultCapacity,
        workloadRatio: w?.workloadRatio ?? 0,
        workloadStatus: w?.workloadStatus ?? 'underutilized',
        isCurrentUser: true,
      });
    } else if (currentEmail) {
      const idx = list.findIndex(r => r.email.toLowerCase() === currentEmail);
      if (idx >= 0) list[idx].isCurrentUser = true;
    }

    setMerged(list);
  }, [recData, workloadData, defaultCapacity, currentEmail]);

  // sorted list
  const sorted = [...merged].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'workload') return b.workloadRatio - a.workloadRatio;
    // performance: total desc
    return b.total - a.total;
  });

  // fetch candidates for dialog
  const fetchCandidates = useCallback(async () => {
    if (!selected) return;
    setCandLoading(true);
    try {
      const params = new URLSearchParams({ recruiterEmail: selected.email, page: String(page), limit: '30' });
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const token = localStorage.getItem('accessToken') || '';
      const res = await fetch(`${API_URL}/api/candidates/hub-profiles?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setCandidates(json.profiles || []);
        setCandTotal(json.total || 0);
      }
    } finally {
      setCandLoading(false);
    }
  }, [selected, search, statusFilter, page]);

  useEffect(() => { setPage(1); }, [search, statusFilter, selected]);
  useEffect(() => { if (selected) fetchCandidates(); }, [fetchCandidates]);

  const openRecruiter = (r: MergedRecruiter) => {
    setSelected(r);
    setSearch('');
    setStatusFilter('all');
    setPage(1);
  };

  const saveCapacities = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await hubFetch(`${API_URL}/api/candidates/hub-config`, navigate, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'workloadConfig', value: { defaultCapacity, capacities: capacityOverrides } }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveMsg('Capacity settings saved.');
      fetchWorkload();
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const loading = recLoading || workloadLoading;
  const error = recError || workloadError;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (error || merged.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-4">
        {error ? `Failed to load: ${error}` : 'No recruiter data found.'}
      </div>
    );
  }

  const maxTotal = Math.max(...merged.map(r => r.total), 1);
  const totalPages = Math.ceil(candTotal / 30);

  return (
    <>
      <div className="space-y-4">
        {/* Sort toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Sort by:</span>
          {(['performance', 'workload', 'name'] as SortKey[]).map(key => (
            <button
              key={key}
              onClick={() => setSortBy(key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
                sortBy === key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary/50'
              }`}
            >
              {key}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            {sorted.length} recruiter{sorted.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Recruiter cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map(r => {
            const wCfg = STATUS_CONFIG[r.workloadStatus];
            const barPercent = Math.min(r.workloadRatio * 100, 100);
            return (
              <Card
                key={r.email}
                className={`cursor-pointer hover:bg-muted/40 transition-colors border ${
                  r.isCurrentUser ? 'ring-2 ring-violet-500/60' : ''
                }`}
                onClick={() => openRecruiter(r)}
              >
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <CardTitle className="text-sm font-semibold truncate">{r.name}</CardTitle>
                        {r.isCurrentUser && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-500 border border-violet-500/30 shrink-0">
                            You
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">{r.email}</p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] px-1.5 shrink-0 ${wCfg.badgeClass}`}>
                      {wCfg.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-2">
                  {/* Workload bar */}
                  <div className="space-y-1">
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${wCfg.barColor}`}
                        style={{ width: `${barPercent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground">
                        {r.active} active / {r.capacity} capacity
                      </span>
                      <span className={`font-medium ${wCfg.textColor}`}>
                        {Math.round(r.workloadRatio * 100)}%
                      </span>
                    </div>
                  </div>

                  {/* Total bar */}
                  <div className="flex items-center gap-2">
                    <StatBar value={r.total} max={maxTotal} color="bg-primary" />
                    <span className="text-xs font-mono font-semibold w-6 text-right">{r.total}</span>
                    <span className="text-[10px] text-muted-foreground">total</span>
                  </div>

                  {/* Status badges */}
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    <Badge variant="outline" className="text-[10px] px-1.5 text-aurora-emerald border-aurora-emerald/30">{r.active} active</Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5 text-aurora-violet border-aurora-violet/30">{r.po} PO</Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5 text-aurora-amber border-aurora-amber/30">{r.hold} hold</Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5 text-destructive border-destructive/30">{r.backout} backout</Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Admin capacity editor */}
        {isAdmin && (
          <Card>
            <CardHeader
              className="p-3 cursor-pointer select-none"
              onClick={() => setEditorOpen(o => !o)}
            >
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Capacity Editor</CardTitle>
                {editorOpen
                  ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </CardHeader>
            {editorOpen && (
              <CardContent className="p-3 pt-0 space-y-4">
                <div className="space-y-1">
                  <Label className="text-xs">Default Capacity</Label>
                  <Input
                    type="number"
                    min={1}
                    className="h-8 text-sm w-32"
                    value={defaultCapacity}
                    onChange={e => setDefaultCapacity(Number(e.target.value))}
                  />
                  <p className="text-[10px] text-muted-foreground">Applies to all recruiters without a custom value.</p>
                </div>
                {merged.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs">Per-Recruiter Capacity</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {merged.filter(r => !r.isCurrentUser || merged.some(x => x.email === r.email && !x.isCurrentUser)).map(r => (
                        <div key={r.email} className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium truncate">{r.name}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{r.email}</div>
                          </div>
                          <Input
                            type="number"
                            min={1}
                            className="h-7 text-xs w-16 shrink-0"
                            value={capacityOverrides[r.email] ?? defaultCapacity}
                            onChange={e =>
                              setCapacityOverrides(prev => ({ ...prev, [r.email]: Number(e.target.value) }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={saveCapacities} disabled={saving}>
                    {saving ? 'Saving…' : 'Save Capacity Settings'}
                  </Button>
                  {saveMsg && (
                    <span className={`text-xs ${saveMsg.includes('aved') ? 'text-aurora-emerald' : 'text-destructive'}`}>
                      {saveMsg}
                    </span>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        )}
      </div>

      {/* Candidates dialog */}
      <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-base">{selected?.name}</DialogTitle>
              <div className="flex gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-[10px] text-aurora-emerald border-aurora-emerald/30">{selected?.active} active</Badge>
                <Badge variant="outline" className="text-[10px] text-aurora-violet border-aurora-violet/30">{selected?.po} PO</Badge>
                <Badge variant="outline" className="text-[10px] text-aurora-amber border-aurora-amber/30">{selected?.hold} hold</Badge>
                <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">{selected?.backout} backout</Badge>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">{selected?.email}</p>
          </DialogHeader>

          <div className="px-5 py-3 flex flex-wrap items-center gap-2 border-b shrink-0">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search candidate or technology…"
                className="pl-8 h-8 text-xs"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground ml-auto">{candTotal} candidates</span>
          </div>

          <div className="flex-1 overflow-auto px-5 pb-3">
            {candLoading ? (
              <div className="space-y-2 pt-3">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 rounded" />)}
              </div>
            ) : (
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] uppercase tracking-wider">Candidate</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Technology</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Branch</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-right">Updated</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">
                        No candidates match.
                      </TableCell>
                    </TableRow>
                  ) : candidates.map(c => {
                    const days = daysAgo(c.updatedAt);
                    const statusKey = (c.status || 'Unassigned') as CandidateStatus;
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs font-medium">
                          <button className="hover:underline text-left" onClick={() => navigate(`/candidate/${c.id}`)}>
                            {c.name}
                          </button>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.technology || '—'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] px-1.5">{c.branch}</Badge>
                        </TableCell>
                        <TableCell>
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${statusColors[statusKey] || ''}`}>
                            {c.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-right text-[10px] text-muted-foreground font-mono">
                          {days !== null ? `${days}d ago` : '—'}
                        </TableCell>
                        <TableCell>
                          <button className="text-primary hover:text-primary/80" onClick={() => navigate(`/candidate/${c.id}`)}>
                            <ExternalLink className="h-3.5 w-3.5" />
                          </button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          {totalPages > 1 && (
            <div className="px-5 pb-4 flex items-center justify-between border-t pt-3 shrink-0">
              <Button variant="outline" size="sm" className="text-xs h-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</Button>
              <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
              <Button variant="outline" size="sm" className="text-xs h-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
