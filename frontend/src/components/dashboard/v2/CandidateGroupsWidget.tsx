import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, User } from 'lucide-react';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { statusColors, type CandidateStatus } from '@/components/profile-hub/mockData';

interface CandidateRow {
  id: string;
  name: string;
  technology: string;
  branch: string;
  recruiter: string;
  expert: string;
  updatedAt: string | null;
}

interface Group {
  status: string;
  count: number;
  candidates: CandidateRow[];
}

function daysAgo(d: string | null) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

function fmtEmail(email: string) {
  if (!email) return '—';
  return email.split('@')[0].split(/[._]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

const STATUS_ACCENT: Record<string, string> = {
  'Active':          'border-l-emerald-500',
  'Placement Offer': 'border-l-violet-500',
  'Hold':            'border-l-amber-500',
  'Backout':         'border-l-red-500',
  'Low Priority':    'border-l-sky-500',
  'Unassigned':      'border-l-muted-foreground',
};

export function CandidateGroupsWidget() {
  const { authFetch } = useAuth();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLoading(true);
    authFetch(`${API_URL}/api/candidates/grouped`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) throw new Error(json.error);
        setGroups(json.groups || []);
        setTotal(json.total || 0);
        // Auto-open first non-empty group
        if (json.groups?.length) setOpen({ [json.groups[0].status]: true });
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [authFetch]);

  if (loading) return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded-lg" />)}
    </div>
  );

  if (error) return (
    <div className="text-xs text-destructive p-3 border border-destructive/30 rounded-md">
      Failed to load candidates: {error}
    </div>
  );

  if (!groups.length) return (
    <div className="text-xs text-muted-foreground p-4 text-center">No candidates in scope.</div>
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">{total.toLocaleString()} candidates across {groups.length} statuses</span>
      </div>

      {groups.map(group => {
        const isOpen = !!open[group.status];
        const accentClass = STATUS_ACCENT[group.status] || 'border-l-muted-foreground';
        const statusKey = group.status as CandidateStatus;

        return (
          <div key={group.status} className={`border rounded-lg border-l-4 ${accentClass} overflow-hidden`}>
            {/* Group header */}
            <button
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-muted/40 transition-colors"
              onClick={() => setOpen(prev => ({ ...prev, [group.status]: !prev[group.status] }))}
            >
              <div className="flex items-center gap-2">
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${statusColors[statusKey] || 'border-border text-muted-foreground'}`}>
                  {group.status}
                </span>
              </div>
              <Badge variant="secondary" className="text-[10px] font-mono">{group.count}</Badge>
            </button>

            {/* Candidate rows */}
            {isOpen && (
              <div className="border-t divide-y">
                {group.candidates.map(c => {
                  const days = daysAgo(c.updatedAt);
                  const role = localStorage.getItem('role') || '';
                  const isTech = ['user', 'expert', 'lead', 'am'].includes(role.toLowerCase());
                  const ownerLabel = isTech ? fmtEmail(c.recruiter) : fmtEmail(c.expert);
                  const ownerPrefix = isTech ? 'Recruiter' : 'Expert';

                  return (
                    <button
                      key={c.id}
                      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-muted/30 transition-colors text-left"
                      onClick={() => navigate(`/candidate/${c.id}`)}
                    >
                      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <User className="h-3 w-3 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{c.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {c.technology || 'No tech'} · {c.branch}
                          {ownerLabel !== '—' && <> · {ownerPrefix}: {ownerLabel}</>}
                        </div>
                      </div>
                      {days !== null && (
                        <span className={`text-[10px] font-mono shrink-0 ${days > 30 ? 'text-destructive' : days > 14 ? 'text-aurora-amber' : 'text-muted-foreground'}`}>
                          {days}d ago
                        </span>
                      )}
                    </button>
                  );
                })}
                {group.count > 20 && (
                  <div className="px-4 py-2 text-[10px] text-muted-foreground text-center">
                    + {group.count - 20} more — view all in Profile Hub
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
