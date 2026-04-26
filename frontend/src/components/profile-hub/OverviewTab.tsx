import { Users, CheckCircle, TrendingUp, AlertTriangle, XCircle, Clock, HelpCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useHubFetch } from './useHubApi';
import ConveyorChart from '@/components/shared/ConveyorChart';

interface HubStats {
  kpi: { total: number; active: number; po: number; hold: number; backout: number; lowPriority: number; unassigned: number };
  branches: { name: string; count: number; color: string }[];
  statusBreakdown: { status: string; count: number }[];
}

interface Props { onNavigate?: (tab: string, params?: Record<string, string>) => void }

// status: undefined means navigate to tab directly; otherwise filters ProfilesTab by that status
const KPI_CONFIG = [
  { key: 'total',       label: 'Total Profiles', icon: Users,         color: 'text-primary',              bar: 'bg-primary',              tab: 'profiles',  status: undefined           },
  { key: 'active',      label: 'Active',         icon: CheckCircle,   color: 'text-aurora-emerald',       bar: 'bg-aurora-emerald',       tab: 'profiles',  status: 'Active'            },
  { key: 'po',          label: 'PO Placed',      icon: TrendingUp,    color: 'text-aurora-violet',        bar: 'bg-aurora-violet',        tab: 'po',        status: undefined           },
  { key: 'hold',        label: 'Hold',           icon: Clock,         color: 'text-aurora-amber',         bar: 'bg-aurora-amber',         tab: 'alerts',    status: undefined           },
  { key: 'backout',     label: 'Backout',        icon: XCircle,       color: 'text-destructive',          bar: 'bg-destructive',          tab: 'profiles',  status: 'Backout'           },
  { key: 'lowPriority', label: 'Low Priority',   icon: AlertTriangle, color: 'text-aurora-cyan',          bar: 'bg-aurora-cyan',          tab: 'profiles',  status: 'Low Priority'      },
  { key: 'unassigned',  label: 'Unassigned',     icon: HelpCircle,    color: 'text-muted-foreground/70',  bar: 'bg-muted-foreground',     tab: 'profiles',  status: 'Unassigned'        },
] as const;

export default function OverviewTab({ onNavigate }: Props) {
  const { data, loading, error } = useHubFetch<HubStats>('hub-stats');

  if (loading) return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        {KPI_CONFIG.map(k => <Skeleton key={k.key} className="h-24 rounded-lg" />)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-56 rounded-lg" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
    </div>
  );

  if (error || !data) return (
    <div className="text-sm text-muted-foreground p-4">Failed to load stats: {error}</div>
  );

  const { kpi, branches } = data;
  const total = kpi.total || 1;

  return (
    <div className="space-y-4">
      <ConveyorChart
        title="This Week's Pipeline Activity"
        height={220}
        items={[
          { label: 'Active',    value: kpi.active,      color: '#10b981' },
          { label: 'PO',        value: kpi.po,          color: '#8b5cf6' },
          { label: 'Hold',      value: kpi.hold,        color: '#fbbf24' },
          { label: 'Backout',   value: kpi.backout,     color: '#fb7185' },
          { label: 'Low Pri.',  value: kpi.lowPriority, color: '#22d3ee' },
        ]}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        {KPI_CONFIG.map(({ key, label, icon: Icon, color, bar, tab, status }) => {
          const value = kpi[key] ?? 0;
          const clickable = !!onNavigate;
          const handleClick = clickable
            ? () => onNavigate?.(tab, status ? { status } : undefined)
            : undefined;
          return (
            <Card
              key={key}
              className={`relative overflow-hidden transition-colors ${clickable ? 'cursor-pointer hover:bg-muted/40' : ''}`}
              onClick={handleClick}
            >
              <CardContent className="p-4">
                <div className={`mb-2 ${color}`}><Icon className="h-4 w-4" /></div>
                <div className="text-2xl font-bold font-mono">{value.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground mt-1 uppercase tracking-wide">{label}</div>
                <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${bar}`} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Branch Distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {branches.map(({ name, count, color }) => (
              <div key={name} className="flex items-center gap-3">
                <span className="w-20 text-xs font-semibold text-muted-foreground truncate">{name}</span>
                <div className="flex-1">
                  <Progress value={Math.round((count / total) * 100)} className="h-5"
                    style={{ '--progress-color': color } as React.CSSProperties} />
                </div>
                <span className="w-12 text-right font-mono text-sm font-semibold">{count}</span>
                <span className="w-10 text-right text-xs text-muted-foreground">
                  {Math.round((count / total) * 100)}%
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {KPI_CONFIG.slice(1).map(({ key, label, bar, tab, status }) => {
              const value = kpi[key] ?? 0;
              return (
                <div
                  key={key}
                  className={`flex items-center gap-3 ${onNavigate ? 'cursor-pointer hover:opacity-80' : ''}`}
                  onClick={() => onNavigate?.(tab, status ? { status } : undefined)}
                >
                  <span className="w-28 text-xs text-muted-foreground truncate">{label}</span>
                  <div className="flex-1">
                    <div className="h-4 rounded bg-muted overflow-hidden">
                      <div className={`h-4 rounded ${bar} transition-all`}
                        style={{ width: `${Math.round((value / total) * 100)}%` }} />
                    </div>
                  </div>
                  <span className="w-10 text-right font-mono text-sm font-semibold">{value}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
