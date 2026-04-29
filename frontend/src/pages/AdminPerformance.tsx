import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth, API_URL } from '@/hooks/useAuth';

interface PerfRow {
  email: string;
  role: string;
  avgMs: number;
  maxMs: number;
  requests: number;
  slowRequests: number;
}

type SortKey = keyof PerfRow;

function timeBadge(ms: number) {
  const cls =
    ms < 200 ? 'bg-emerald-500/20 text-emerald-400' :
    ms < 500 ? 'bg-amber-500/20 text-amber-400' :
    'bg-rose-500/20 text-rose-400';
  return <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-xs ${cls}`}>{ms}ms</span>;
}

export default function AdminPerformance() {
  const navigate = useNavigate();
  const { authFetch } = useAuth();
  const [rows, setRows] = useState<PerfRow[]>([]);
  const [since, setSince] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('avgMs');
  const [sortAsc, setSortAsc] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const role = (localStorage.getItem('role') || '').trim().toLowerCase();
  const email = (localStorage.getItem('email') || '').trim().toLowerCase();
  // Allow admin role OR the platform-owner allow-list.
  const PERF_ALLOWLIST = new Set(['harsh.patel@silverspaceinc.com']);
  if (role !== 'admin' && !PERF_ALLOWLIST.has(email)) {
    navigate('/');
    return null;
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`${API_URL}/api/admin/performance`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to load');
      setRows(data.rows);
      setSince(data.since ? new Date(data.since).toLocaleString() : '');
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const data = q ? rows.filter(r => r.email.toLowerCase().includes(q) || r.role.toLowerCase().includes(q)) : rows;
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, search, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(v => !v);
    else { setSortKey(key); setSortAsc(false); }
  };

  const thCls = (key: SortKey) =>
    `cursor-pointer select-none px-4 py-3 text-left text-xs font-medium uppercase tracking-wider ${sortKey === key ? 'text-primary' : 'text-muted-foreground'}`;

  const arrow = (key: SortKey) => sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '';

  return (
    <DashboardLayout>
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Performance Monitor</h1>
          {since && <p className="text-xs text-muted-foreground mt-0.5">Last 24 hours · since {since}</p>}
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-xs text-muted-foreground">Updated {lastRefresh.toLocaleTimeString()}</span>
          )}
          <Button size="sm" variant="outline" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <CardTitle className="text-base">Per-User Load Times</CardTitle>
            <Badge variant="secondary">{filtered.length} users</Badge>
            <div className="ml-auto">
              <Input
                placeholder="Search email or role…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-56 h-8 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className={thCls('email')} onClick={() => handleSort('email')}>Email{arrow('email')}</th>
                  <th className={thCls('role')} onClick={() => handleSort('role')}>Role{arrow('role')}</th>
                  <th className={thCls('avgMs')} onClick={() => handleSort('avgMs')}>Avg Time{arrow('avgMs')}</th>
                  <th className={thCls('maxMs')} onClick={() => handleSort('maxMs')}>Max{arrow('maxMs')}</th>
                  <th className={thCls('requests')} onClick={() => handleSort('requests')}>Requests{arrow('requests')}</th>
                  <th className={thCls('slowRequests')} onClick={() => handleSort('slowRequests')}>Slow (&gt;1s){arrow('slowRequests')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      {loading ? 'Loading…' : 'No data'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((row, i) => (
                    <tr key={i} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs truncate max-w-[220px]">{row.email}</td>
                      <td className="px-4 py-3">
                        {row.role && <Badge variant="outline" className="text-xs">{row.role}</Badge>}
                      </td>
                      <td className="px-4 py-3">{timeBadge(row.avgMs)}</td>
                      <td className="px-4 py-3">{timeBadge(row.maxMs)}</td>
                      <td className="px-4 py-3 text-center">{row.requests}</td>
                      <td className="px-4 py-3 text-center">
                        {row.slowRequests > 0 ? (
                          <span className="text-rose-400 font-semibold">{row.slowRequests}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
    </DashboardLayout>
  );
}
