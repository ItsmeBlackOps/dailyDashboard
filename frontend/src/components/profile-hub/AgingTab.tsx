import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, Filter, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { API_URL } from '@/hooks/useAuth';
import { useNavigate as _useNavigate } from 'react-router-dom';
import { requestRefreshToken } from '@/hooks/useAuth';

// ── types ─────────────────────────────────────────────────────────────────────

type AgingStatus = 'fresh' | 'warm' | 'aging' | 'critical';

interface AgingCandidate {
  _id: string;
  name: string;
  recruiter: string;
  branch: string;
  status: string;
  idleDays: number;
  agingStatus: AgingStatus;
  lastActivity: string;
}

interface AgingThresholds { fresh: number; warm: number; aging: number }

interface AgingResponse {
  success: boolean;
  thresholds: AgingThresholds;
  summary: { fresh: number; warm: number; aging: number; critical: number; total: number };
  candidates: AgingCandidate[];
}

interface HubConfigResponse {
  agingThresholds: AgingThresholds;
}

// ── constants ─────────────────────────────────────────────────────────────────

const BRANCHES = ['all', 'GGR', 'LKN', 'AHM', 'LKO', 'UK'];
const AGING_STATUSES: Array<'all' | AgingStatus> = ['all', 'fresh', 'warm', 'aging', 'critical'];

// ── helpers ───────────────────────────────────────────────────────────────────

async function hubFetch(url: string, navigate: ReturnType<typeof _useNavigate>, options?: RequestInit): Promise<Response> {
  const doFetch = (token: string) =>
    fetch(url, { ...options, headers: { ...(options?.headers ?? {}), Authorization: `Bearer ${token}` } });

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

const BUCKET_CONFIG: Record<AgingStatus, { label: string; color: string; bg: string; border: string; badge: string }> = {
  fresh:    { label: 'Fresh',    color: 'text-aurora-emerald',  bg: 'bg-aurora-emerald/10',  border: 'border-aurora-emerald/30',  badge: 'bg-aurora-emerald/15 text-aurora-emerald border-aurora-emerald/30' },
  warm:     { label: 'Warm',     color: 'text-aurora-amber',    bg: 'bg-aurora-amber/10',    border: 'border-aurora-amber/30',    badge: 'bg-aurora-amber/15 text-aurora-amber border-aurora-amber/30' },
  aging:    { label: 'Aging',    color: 'text-aurora-amber',    bg: 'bg-aurora-amber/10',    border: 'border-aurora-amber/30',    badge: 'bg-aurora-amber/15 text-aurora-amber border-aurora-amber/30' },
  critical: { label: 'Critical', color: 'text-destructive',     bg: 'bg-destructive/10',     border: 'border-destructive/30',     badge: 'bg-destructive/15 text-destructive border-destructive/30' },
};

function thresholdLabel(status: AgingStatus, thresholds: AgingThresholds): string {
  switch (status) {
    case 'fresh':    return `≤${thresholds.fresh}d`;
    case 'warm':     return `${thresholds.fresh + 1}–${thresholds.warm}d`;
    case 'aging':    return `${thresholds.warm + 1}–${thresholds.aging}d`;
    case 'critical': return `>${thresholds.aging}d`;
  }
}

// ── component ─────────────────────────────────────────────────────────────────

export default function AgingTab() {
  const navigate = useNavigate();
  const role = localStorage.getItem('role');
  const isAdmin = role === 'admin';

  // aging data state
  const [agingData, setAgingData] = useState<AgingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // filters
  const [branchFilter, setBranchFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | AgingStatus>('all');

  // admin threshold editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [thresholds, setThresholds] = useState<AgingThresholds>({ fresh: 2, warm: 7, aging: 14 });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // fetch aging data
  const fetchAging = useCallback(async (branch: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = branch === 'all'
        ? `${API_URL}/api/candidates/hub-aging`
        : `${API_URL}/api/candidates/hub-aging?branch=${branch}`;
      const res = await hubFetch(url, navigate);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: AgingResponse = await res.json();
      if (!json.success) throw new Error('Request failed');
      setAgingData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  // fetch config (admin only — for threshold editor)
  const fetchConfig = useCallback(async () => {
    try {
      const res = await hubFetch(`${API_URL}/api/candidates/hub-config`, navigate);
      if (!res.ok) return;
      const json: { success?: boolean } & HubConfigResponse = await res.json();
      if (json.agingThresholds) setThresholds(json.agingThresholds);
    } catch {
      // silently ignore
    }
  }, [navigate]);

  useEffect(() => { fetchAging(branchFilter); }, [branchFilter, fetchAging]);
  useEffect(() => { if (isAdmin) fetchConfig(); }, [isAdmin, fetchConfig]);

  const saveThresholds = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await hubFetch(`${API_URL}/api/candidates/hub-config`, navigate, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'agingThresholds', value: thresholds }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveMsg('Thresholds saved.');
      fetchAging(branchFilter);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // filtered candidates
  const filtered = (agingData?.candidates ?? [])
    .filter(c => statusFilter === 'all' || c.agingStatus === statusFilter)
    .sort((a, b) => b.idleDays - a.idleDays);

  // ── loading skeleton ──
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}
        </div>
      </div>
    );
  }

  // ── error ──
  if (error || !agingData) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="p-4 flex items-center gap-3">
          <span className="text-sm text-destructive">{error ?? 'Unknown error'}</span>
          <Button size="sm" variant="outline" onClick={() => fetchAging(branchFilter)}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { summary, thresholds: t } = agingData;
  const buckets: AgingStatus[] = ['fresh', 'warm', 'aging', 'critical'];

  return (
    <div className="space-y-4">
      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {buckets.map(bucket => {
          const cfg = BUCKET_CONFIG[bucket];
          return (
            <Card
              key={bucket}
              className={`${cfg.bg} ${cfg.border} border cursor-pointer transition-opacity hover:opacity-80`}
              onClick={() => setStatusFilter(statusFilter === bucket ? 'all' : bucket)}
            >
              <CardContent className="p-3">
                <div className={`text-2xl font-bold ${cfg.color}`}>{summary[bucket]}</div>
                <div className={`text-xs font-semibold mt-0.5 ${cfg.color}`}>{cfg.label}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{thresholdLabel(bucket, t)}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Admin threshold editor ── */}
      {isAdmin && (
        <Card>
          <CardHeader
            className="p-3 cursor-pointer select-none"
            onClick={() => setEditorOpen(o => !o)}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Threshold Editor</CardTitle>
              {editorOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </CardHeader>
          {editorOpen && (
            <CardContent className="p-3 pt-0 space-y-3">
              <div className="grid grid-cols-3 gap-3">
                {(['fresh', 'warm', 'aging'] as const).map(key => (
                  <div key={key} className="space-y-1">
                    <Label className="text-xs capitalize">{key} (days)</Label>
                    <Input
                      type="number"
                      min={1}
                      className="h-8 text-sm"
                      value={thresholds[key]}
                      onChange={e => setThresholds(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={saveThresholds} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Thresholds'}
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

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <Select value={branchFilter} onValueChange={setBranchFilter}>
          <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {BRANCHES.map(b => (
              <SelectItem key={b} value={b} className="text-xs">{b === 'all' ? 'All Branches' : b}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as 'all' | AgingStatus)}>
          <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {AGING_STATUSES.map(s => (
              <SelectItem key={s} value={s} className="text-xs capitalize">{s === 'all' ? 'All Statuses' : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} candidate{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Table ── */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">No candidates match.</div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Recruiter</TableHead>
                <TableHead className="text-xs">Branch</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Idle Days</TableHead>
                <TableHead className="text-xs">Aging</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(c => {
                const cfg = BUCKET_CONFIG[c.agingStatus];
                return (
                  <TableRow key={c._id} className="cursor-pointer hover:bg-muted/40" onClick={() => navigate(`/candidate/${c._id}`)}>
                    <TableCell className="text-xs font-medium py-2">{c.name}</TableCell>
                    <TableCell className="text-xs py-2 text-muted-foreground">{c.recruiter}</TableCell>
                    <TableCell className="text-xs py-2">{c.branch}</TableCell>
                    <TableCell className="text-xs py-2">{c.status}</TableCell>
                    <TableCell className="text-xs py-2 text-right font-mono">{c.idleDays}d</TableCell>
                    <TableCell className="py-2">
                      <Badge variant="outline" className={`text-[10px] px-1.5 ${cfg.badge}`}>
                        {cfg.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
