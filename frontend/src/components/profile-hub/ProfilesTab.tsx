import { useState, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { statusColors, type CandidateStatus } from './mockData';
import { API_URL } from '@/hooks/useAuth';

interface Profile {
  id: string; name: string; technology: string; branch: string;
  recruiter: string; status: string; updatedAt: string; poDate?: string | null;
}

function formatRecruiter(email: string) {
  return email.split('@')[0].split(/[._]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

function daysAgo(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

const BRANCHES = ['GGR', 'LKN', 'AHM', 'UK', 'Unassigned'];
const STATUSES: CandidateStatus[] = ['Active', 'Placement Offer', 'Hold', 'Backout', 'Low Priority', 'Unassigned'];

export default function ProfilesTab() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filterBranch, setFilterBranch] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (search) params.set('search', search);
      if (filterBranch !== 'all') params.set('branch', filterBranch);
      if (filterStatus !== 'all') params.set('status', filterStatus);
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_URL}/api/candidates/hub-profiles?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setProfiles(json.profiles || []);
      setTotal(json.total || 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [search, filterBranch, filterStatus, page]);

  useEffect(() => { setPage(1); }, [search, filterBranch, filterStatus]);
  useEffect(() => { fetchProfiles(); }, [fetchProfiles]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search candidate, technology or recruiter…" className="pl-8 h-8 text-xs"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterBranch} onValueChange={setFilterBranch}>
          <SelectTrigger className="w-32 h-8 text-xs"><SelectValue placeholder="Branch" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Branches</SelectItem>
            {BRANCHES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">
          {loading ? '…' : `${total.toLocaleString()} results`}
        </span>
      </div>

      <div className="rounded-md border overflow-hidden">
        <div className="max-h-[520px] overflow-auto">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] uppercase tracking-wider">Candidate</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Technology</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Branch</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Recruiter</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-right">Last Update</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-xs text-destructive py-8">{error}</TableCell>
                </TableRow>
              ) : profiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">No profiles match your filters.</TableCell>
                </TableRow>
              ) : profiles.map(c => {
                const days = c.updatedAt ? daysAgo(c.updatedAt) : null;
                const isAging = c.status === 'Hold' && days !== null && days > 10;
                const statusKey = (c.status || 'Unassigned') as CandidateStatus;
                return (
                  <TableRow key={c.id} className={isAging ? 'bg-aurora-amber/5 border-l-2 border-l-aurora-amber' : ''}>
                    <TableCell className="text-xs font-medium">
                      <button className="hover:underline text-left" onClick={() => navigate(`/candidate/${c.id}`)}>{c.name}</button>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.technology || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] px-1.5">{c.branch}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatRecruiter(c.recruiter)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${statusColors[statusKey] || ''}`}>
                        {c.status || 'Unassigned'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-[10px] text-muted-foreground font-mono">
                      {days !== null ? `${days}d ago` : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <Button variant="outline" size="sm" className="text-xs h-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</Button>
          <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" className="text-xs h-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</Button>
        </div>
      )}
    </div>
  );
}
