import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, CartesianGrid } from 'recharts';
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
  { key: 'active',      label: 'Active',          gradId: 'pieEmerald' },
  { key: 'po',          label: 'Placement Offer',  gradId: 'pieViolet' },
  { key: 'hold',        label: 'Hold',             gradId: 'pieAmber'  },
  { key: 'backout',     label: 'Backout',          gradId: 'pieRose'   },
  { key: 'lowPriority', label: 'Low Priority',     gradId: 'pieCyan'   },
  { key: 'unassigned',  label: 'Unassigned',       gradId: 'pieSlate'  },
];

// Aurora tooltip style — shared across all charts
const auroraTooltipStyle = {
  background: 'rgba(20,15,30,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  backdropFilter: 'blur(16px)',
  borderRadius: 8,
  fontFamily: 'Inter Tight, Inter, sans-serif',
  fontSize: 12,
  boxShadow: '0 24px 60px -20px rgba(0,0,0,0.5)',
};

const auroraLabelStyle = {
  color: 'rgba(255,255,255,0.7)',
  fontFamily: 'JetBrains Mono, monospace',
  fontSize: 11,
  textTransform: 'uppercase' as const,
};

const auroraItemStyle = { color: 'white' };

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

// SVG defs shared across all charts — rendered once as a hidden SVG
function AuroraDefs() {
  return (
    <svg width={0} height={0} style={{ position: 'absolute', overflow: 'hidden' }}>
      <defs>
        {/* Bar gradient */}
        <linearGradient id="auroraBarFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.7} />
        </linearGradient>
        {/* Horizontal bar gradient */}
        <linearGradient id="auroraBarFillH" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.7} />
        </linearGradient>
        {/* Stacked bar gradients */}
        <linearGradient id="auroraActive" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
          <stop offset="100%" stopColor="#34d399" stopOpacity={0.7} />
        </linearGradient>
        <linearGradient id="auroraPO" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.95} />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.7} />
        </linearGradient>
        <linearGradient id="auroraHold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.95} />
          <stop offset="100%" stopColor="#fbbf24" stopOpacity={0.7} />
        </linearGradient>
        <linearGradient id="auroraBackout" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fb7185" stopOpacity={0.95} />
          <stop offset="100%" stopColor="#fb7185" stopOpacity={0.7} />
        </linearGradient>
        {/* Pie gradients */}
        <linearGradient id="pieViolet" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id="pieEmerald" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#a3e635" />
        </linearGradient>
        <linearGradient id="pieAmber" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#f97316" />
        </linearGradient>
        <linearGradient id="pieRose" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fb7185" />
          <stop offset="100%" stopColor="#fbbf24" />
        </linearGradient>
        <linearGradient id="pieCyan" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#60a5fa" />
        </linearGradient>
        <linearGradient id="pieSlate" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#64748b" />
        </linearGradient>
        {/* Glow filter */}
        <filter id="auroraGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

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
    .map(s => ({ name: s.label, value: kpi[s.key as keyof typeof kpi] ?? 0, gradId: s.gradId }))
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
    <>
      <AuroraDefs />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Status Distribution — Pie */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Status Distribution</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <defs>
                  {/* inline defs for pie gradient fill refs (recharts needs them in-chart) */}
                  <linearGradient id="pieViolet_l" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" />
                    <stop offset="100%" stopColor="#22d3ee" />
                  </linearGradient>
                  <linearGradient id="pieEmerald_l" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#34d399" />
                    <stop offset="100%" stopColor="#a3e635" />
                  </linearGradient>
                  <linearGradient id="pieAmber_l" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#fbbf24" />
                    <stop offset="100%" stopColor="#f97316" />
                  </linearGradient>
                  <linearGradient id="pieRose_l" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#fb7185" />
                    <stop offset="100%" stopColor="#fbbf24" />
                  </linearGradient>
                  <linearGradient id="pieCyan_l" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#22d3ee" />
                    <stop offset="100%" stopColor="#60a5fa" />
                  </linearGradient>
                  <linearGradient id="pieSlate_l" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#94a3b8" />
                    <stop offset="100%" stopColor="#64748b" />
                  </linearGradient>
                  <filter id="pieGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  innerRadius={35}
                  filter="url(#pieGlow)"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth={1}
                  animationBegin={0}
                  animationDuration={600}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={`url(#${entry.gradId}_l)`} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) => v.toLocaleString()}
                  contentStyle={auroraTooltipStyle}
                  labelStyle={auroraLabelStyle}
                  itemStyle={auroraItemStyle}
                />
                <Legend content={renderLegend} wrapperStyle={{ fontFamily: 'Inter Tight, Inter, sans-serif', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Branch Distribution — horizontal bar */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Branch Distribution</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={branchData} layout="vertical" margin={{ left: 0, right: 20, top: 4, bottom: 4 }}>
                <defs>
                  <linearGradient id="branchBarFill" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.7} />
                  </linearGradient>
                  <filter id="branchGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" horizontal={false} />
                <XAxis
                  type="number"
                  stroke="rgba(255,255,255,0.3)"
                  tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)', fontFamily: 'JetBrains Mono, monospace' }}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke="rgba(255,255,255,0.3)"
                  tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)', fontFamily: 'JetBrains Mono, monospace' }}
                  width={68}
                />
                <Tooltip
                  formatter={(v: number) => v.toLocaleString()}
                  contentStyle={auroraTooltipStyle}
                  labelStyle={auroraLabelStyle}
                  itemStyle={auroraItemStyle}
                  cursor={{ fill: 'rgba(139,92,246,0.08)' }}
                />
                <Bar
                  dataKey="count"
                  fill="url(#branchBarFill)"
                  filter="url(#branchGlow)"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={20}
                  animationBegin={0}
                  animationDuration={800}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Recruiters — stacked bar */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Top Recruiters — Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="overflow-x-auto">
              <div style={{ minWidth: 500 }}>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={barData} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
                    <defs>
                      <linearGradient id="stackActive" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#34d399" stopOpacity={0.65} />
                      </linearGradient>
                      <linearGradient id="stackPO" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.65} />
                      </linearGradient>
                      <linearGradient id="stackHold" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#fbbf24" stopOpacity={0.65} />
                      </linearGradient>
                      <linearGradient id="stackBackout" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fb7185" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="#fb7185" stopOpacity={0.65} />
                      </linearGradient>
                      <filter id="stackGlow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      stroke="rgba(255,255,255,0.3)"
                      tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)', fontFamily: 'JetBrains Mono, monospace' }}
                    />
                    <YAxis
                      stroke="rgba(255,255,255,0.3)"
                      tick={{ fontSize: 10, fill: 'rgba(255,255,255,0.5)', fontFamily: 'JetBrains Mono, monospace' }}
                    />
                    <Tooltip
                      contentStyle={auroraTooltipStyle}
                      labelStyle={auroraLabelStyle}
                      itemStyle={auroraItemStyle}
                      cursor={{ fill: 'rgba(139,92,246,0.08)' }}
                    />
                    <Legend wrapperStyle={{ fontFamily: 'Inter Tight, Inter, sans-serif', fontSize: 10 }} />
                    <Bar dataKey="Active"  stackId="a" fill="url(#stackActive)"  animationBegin={0}   animationDuration={800} />
                    <Bar dataKey="PO"      stackId="a" fill="url(#stackPO)"      animationBegin={100} animationDuration={800} />
                    <Bar dataKey="Hold"    stackId="a" fill="url(#stackHold)"    animationBegin={200} animationDuration={800} />
                    <Bar dataKey="Backout" stackId="a" fill="url(#stackBackout)" animationBegin={300} animationDuration={800} radius={[4, 4, 0, 0]} filter="url(#stackGlow)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
