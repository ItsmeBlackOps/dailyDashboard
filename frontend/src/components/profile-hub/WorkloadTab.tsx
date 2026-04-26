import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { API_URL, requestRefreshToken } from '@/hooks/useAuth';

// ── types ─────────────────────────────────────────────────────────────────────

type WorkloadStatus = 'overloaded' | 'optimal' | 'underutilized';

interface RecruiterWorkload {
  email: string;
  name: string;
  activeCount: number;
  totalCount: number;
  capacity: number;
  workloadRatio: number;
  workloadStatus: WorkloadStatus;
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

interface HubConfigResponse {
  agingThresholds: Record<string, number>;
  workloadConfig: WorkloadConfig;
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

// ── status config ─────────────────────────────────────────────────────────────

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

const SUMMARY_CARDS: Array<{ status: WorkloadStatus; emoji: string; description: string }> = [
  { status: 'overloaded',    emoji: '🔴', description: '>90% capacity' },
  { status: 'optimal',       emoji: '🟢', description: '40–90% capacity' },
  { status: 'underutilized', emoji: '🔵', description: '<40% capacity' },
];

// ── component ─────────────────────────────────────────────────────────────────

export default function WorkloadTab() {
  const navigate = useNavigate();
  const role = localStorage.getItem('role');
  const isAdmin = role === 'admin';

  // workload data
  const [workloadData, setWorkloadData] = useState<WorkloadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // admin capacity editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [defaultCapacity, setDefaultCapacity] = useState(10);
  const [capacityOverrides, setCapacityOverrides] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const fetchWorkload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hubFetch(`${API_URL}/api/candidates/hub-workload`, navigate);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: WorkloadResponse = await res.json();
      if (!json.success) throw new Error('Request failed');
      setWorkloadData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await hubFetch(`${API_URL}/api/candidates/hub-config`, navigate);
      if (!res.ok) return;
      const json: HubConfigResponse = await res.json();
      if (json.workloadConfig) {
        setDefaultCapacity(json.workloadConfig.defaultCapacity ?? 10);
        setCapacityOverrides(json.workloadConfig.capacities ?? {});
      }
    } catch {
      // silently ignore
    }
  }, [navigate]);

  useEffect(() => { fetchWorkload(); }, [fetchWorkload]);
  useEffect(() => { if (isAdmin) fetchConfig(); }, [isAdmin, fetchConfig]);

  const saveCapacities = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await hubFetch(`${API_URL}/api/candidates/hub-config`, navigate, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: 'workloadConfig',
          value: { defaultCapacity, capacities: capacityOverrides },
        }),
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

  // ── loading skeleton ──
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // ── error ──
  if (error || !workloadData) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="p-4 flex items-center gap-3">
          <span className="text-sm text-destructive">{error ?? 'Unknown error'}</span>
          <Button size="sm" variant="outline" onClick={fetchWorkload}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { recruiters } = workloadData;

  const summaryCounts = SUMMARY_CARDS.reduce<Record<WorkloadStatus, number>>(
    (acc, { status }) => {
      acc[status] = recruiters.filter(r => r.workloadStatus === status).length;
      return acc;
    },
    { overloaded: 0, optimal: 0, underutilized: 0 },
  );

  return (
    <div className="space-y-4">
      {/* ── Summary cards ── */}
      <div className="grid grid-cols-3 gap-3">
        {SUMMARY_CARDS.map(({ status, emoji, description }) => {
          const cfg = STATUS_CONFIG[status];
          return (
            <Card key={status} className={`${cfg.bgColor} ${cfg.borderColor} border`}>
              <CardContent className="p-3">
                <div className={`text-2xl font-bold ${cfg.textColor}`}>{summaryCounts[status]}</div>
                <div className={`text-xs font-semibold mt-0.5 ${cfg.textColor}`}>
                  {emoji} {cfg.label}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{description}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Admin capacity editor ── */}
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
              {/* Default capacity */}
              <div className="space-y-1">
                <Label className="text-xs">Default Capacity</Label>
                <Input
                  type="number"
                  min={1}
                  className="h-8 text-sm w-32"
                  value={defaultCapacity}
                  onChange={e => setDefaultCapacity(Number(e.target.value))}
                />
                <p className="text-[10px] text-muted-foreground">
                  Applies to all recruiters without a custom value.
                </p>
              </div>

              {/* Per-recruiter overrides */}
              {recruiters.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs">Per-Recruiter Capacity</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {recruiters.map(r => (
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
                            setCapacityOverrides(prev => ({
                              ...prev,
                              [r.email]: Number(e.target.value),
                            }))
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
                  <span
                    className={`text-xs ${
                      saveMsg.includes('aved') ? 'text-aurora-emerald' : 'text-destructive'
                    }`}
                  >
                    {saveMsg}
                  </span>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* ── Recruiter cards grid ── */}
      {recruiters.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">No recruiters found.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {recruiters.map(r => {
            const cfg = STATUS_CONFIG[r.workloadStatus];
            const barPercent = Math.min(r.workloadRatio * 100, 100);
            return (
              <Card key={r.email} className="border">
                <CardContent className="p-4 space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{r.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{r.email}</div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 shrink-0 ${cfg.badgeClass}`}
                    >
                      {cfg.label}
                    </Badge>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${cfg.barColor}`}
                        style={{ width: `${barPercent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">
                        {r.activeCount} active / {r.capacity} capacity
                      </span>
                      <span className={`font-medium ${cfg.textColor}`}>
                        {Math.round(r.workloadRatio * 100)}%
                      </span>
                    </div>
                  </div>

                  {/* Total profiles */}
                  <div className="text-[11px] text-muted-foreground">
                    {r.totalCount} total profile{r.totalCount !== 1 ? 's' : ''}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
