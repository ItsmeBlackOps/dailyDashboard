import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useHubFetch } from './useHubApi';

interface Recruiter { name: string; total: number; active: number; po: number; hold: number; backout: number }
interface HubStats {
  kpi: { total: number; active: number; po: number; hold: number; backout: number; lowPriority: number; unassigned: number };
  branches: { name: string; count: number; color: string }[];
}
interface HubRecruiters { recruiters: Recruiter[] }

const STATUS_PIE = [
  { key: 'active',      label: 'Active',          color: '#10b981' },
  { key: 'po',          label: 'Placement Offer',  color: '#8b5cf6' },
  { key: 'hold',        label: 'Hold',             color: '#f59e0b' },
  { key: 'backout',     label: 'Backout',          color: '#ef4444' },
  { key: 'lowPriority', label: 'Low Priority',     color: '#0ea5e9' },
  { key: 'unassigned',  label: 'Unassigned',       color: '#6b7280' },
];

const renderLegend = (props: any) => {
  const { payload } = props;
  return (
    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2">
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-1 text-[10px]">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: entry.color }} />
          <span className="text-muted-foreground">{entry.value}</span>
          <span className="font-semibold">{entry.payload.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function AnalyticsTab() {
  const stats      = useHubFetch<HubStats>('hub-stats');
  const recruiters = useHubFetch<HubRecruiters>('hub-recruiters');

  const loading = stats.loading || recruiters.loading;
  const error   = stats.error || recruiters.error;

  if (loading) return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-lg" />)}
    </div>
  );

  if (error || !stats.data || !recruiters.data) return (
    <div className="text-sm text-muted-foreground p-4">Failed to load analytics: {error}</div>
  );

  const kpi = stats.data.kpi;
  const pieData = STATUS_PIE
    .map(s => ({ name: s.label, value: kpi[s.key as keyof typeof kpi] ?? 0, color: s.color }))
    .filter(d => d.value > 0);

  const barData = recruiters.data.recruiters.slice(0, 10).map(r => ({
    name: r.name.split(' ')[0],
    Active: r.active,
    PO: r.po,
    Hold: r.hold,
    Backout: r.backout,
  }));

  const branchData = stats.data.branches.map(b => ({ name: b.name, count: b.count, fill: b.color }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Status Distribution</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} innerRadius={35}>
                {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip formatter={(v: number) => v.toLocaleString()} />
              <Legend content={renderLegend} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Branch Distribution</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={branchData} layout="vertical" margin={{ left: 0, right: 20, top: 4, bottom: 4 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={68} />
              <Tooltip formatter={(v: number) => v.toLocaleString()} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20}>
                {branchData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Top Recruiters — Status Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <div className="overflow-x-auto">
            <div style={{ minWidth: 500 }}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={barData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="Active"  stackId="a" fill="#10b981" />
                  <Bar dataKey="PO"      stackId="a" fill="#8b5cf6" />
                  <Bar dataKey="Hold"    stackId="a" fill="#f59e0b" />
                  <Bar dataKey="Backout" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
