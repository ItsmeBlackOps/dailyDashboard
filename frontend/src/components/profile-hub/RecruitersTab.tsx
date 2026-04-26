import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useHubFetch } from './useHubApi';
import { statusColors, type CandidateStatus } from './mockData';
import { API_URL } from '@/hooks/useAuth';

interface Recruiter {
  email: string; name: string; total: number;
  active: number; po: number; hold: number; backout: number;
}
interface HubRecruiters { recruiters: Recruiter[] }

interface CandidateRow {
  id: string; name: string; technology: string; branch: string;
  recruiter: string; status: string; updatedAt: string | null; poDate?: string | null;
}

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

const STATUSES: CandidateStatus[] = ['Active', 'Placement Offer', 'Hold', 'Backout', 'Low Priority', 'Unassigned'];

export default function RecruitersTab() {
  const navigate = useNavigate();
  const { data, loading, error } = useHubFetch<HubRecruiters>('hub-recruiters');
  const [selected, setSelected] = useState<Recruiter | null>(null);

  // Candidates for selected recruiter
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [candTotal, setCandTotal] = useState(0);
  const [candLoading, setCandLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  const fetchCandidates = useCallback(async () => {
    if (!selected) return;
    setCandLoading(true);
    try {
      const params = new URLSearchParams({
        recruiterEmail: selected.email,
        page: String(page),
        limit: '30',
      });
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

  const openRecruiter = (r: Recruiter) => {
    setSelected(r);
    setSearch('');
    setStatusFilter('all');
    setPage(1);
  };

  if (loading) return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-lg" />)}
    </div>
  );

  if (error || !data) return (
    <div className="text-sm text-muted-foreground p-4">Failed to load recruiters: {error}</div>
  );

  const { recruiters } = data;
  const maxTotal = Math.max(...recruiters.map(r => r.total), 1);
  const totalPages = Math.ceil(candTotal / 30);

  return (
    <>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">Top {recruiters.length} recruiters · click to view candidates</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {recruiters.map(r => (
            <Card key={r.email} className="cursor-pointer hover:bg-muted/40 transition-colors"
              onClick={() => openRecruiter(r)}>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold truncate">{r.name}</CardTitle>
                <p className="text-[10px] text-muted-foreground truncate">{r.email}</p>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <div className="flex items-center gap-2">
                  <StatBar value={r.total} max={maxTotal} color="bg-primary" />
                  <span className="text-xs font-mono font-semibold w-6 text-right">{r.total}</span>
                  <span className="text-[10px] text-muted-foreground">total</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge variant="outline" className="text-[10px] px-1.5 text-aurora-emerald border-aurora-emerald/30">{r.active} active</Badge>
                  <Badge variant="outline" className="text-[10px] px-1.5 text-aurora-violet border-aurora-violet/30">{r.po} PO</Badge>
                  <Badge variant="outline" className="text-[10px] px-1.5 text-aurora-amber border-aurora-amber/30">{r.hold} hold</Badge>
                  <Badge variant="outline" className="text-[10px] px-1.5 text-destructive border-destructive/30">{r.backout} backout</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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

          {/* Filters */}
          <div className="px-5 py-3 flex flex-wrap items-center gap-2 border-b shrink-0">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search candidate or technology…" className="pl-8 h-8 text-xs"
                value={search} onChange={e => setSearch(e.target.value)} />
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

          {/* Table */}
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

          {/* Pagination */}
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
