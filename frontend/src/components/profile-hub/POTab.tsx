import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Calendar } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useHubFetch } from './useHubApi';

interface POCandidate {
  id: string; name: string; branch: string; recruiter: string;
  technology: string; poDate: string | null; updatedAt: string;
}
interface HubPO { total: number; missingPoDate: number; candidates: POCandidate[] }

function formatRecruiter(email: string) {
  return email.split('@')[0].split(/[._]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

function formatDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function POTab() {
  const navigate = useNavigate();
  const { data, loading, error } = useHubFetch<HubPO>('hub-po');
  const [showMissingOnly, setShowMissingOnly] = useState(false);

  if (loading) return (
    <div className="space-y-3">
      <Skeleton className="h-10 rounded-lg" />
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );

  if (error || !data) return (
    <div className="text-sm text-muted-foreground p-4">Failed to load PO data: {error}</div>
  );

  const { total, missingPoDate, candidates } = data;
  const filtered = showMissingOnly ? candidates.filter(c => !c.poDate) : candidates;

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {missingPoDate > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-aurora-amber/30 bg-aurora-amber/5 px-3 py-2">
          <AlertCircle className="h-4 w-4 text-aurora-amber shrink-0" />
          <span className="text-xs text-aurora-amber flex-1">
            {missingPoDate} candidates with "Placement Offer" status are missing a PO date.
          </span>
          <Button variant="outline" size="sm" className="text-xs h-7 border-aurora-amber/40 text-aurora-amber"
            onClick={() => setShowMissingOnly(v => !v)}>
            {showMissingOnly ? 'Show All' : 'Review →'}
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{total} PO placements total</span>
        {showMissingOnly && <Badge variant="destructive" className="text-[10px]">Showing missing PO date only</Badge>}
      </div>

      <div className="rounded-md border overflow-hidden">
        <div className="overflow-y-auto max-h-[calc(100vh-280px)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] uppercase tracking-wider">Candidate</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Technology</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Branch</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Recruiter</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">PO Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-8">
                    No records match.
                  </TableCell>
                </TableRow>
              ) : filtered.map(c => (
                <TableRow key={c.id} className={!c.poDate ? 'bg-aurora-amber/5 border-l-2 border-l-aurora-amber' : ''}>
                  <TableCell className="text-xs font-medium">
                    <button className="hover:underline text-left" onClick={() => navigate(`/candidate/${c.id}`)}>{c.name}</button>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.technology || '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] px-1.5">{c.branch}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatRecruiter(c.recruiter)}</TableCell>
                  <TableCell>
                    {c.poDate ? (
                      <div className="flex items-center gap-1 text-xs text-aurora-emerald">
                        <Calendar className="h-3 w-3" />
                        {formatDate(c.poDate)}
                      </div>
                    ) : (
                      <span className="text-[10px] text-aurora-amber font-semibold">Missing</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
