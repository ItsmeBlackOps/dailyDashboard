import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Filter } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useHubFetch } from './useHubApi';

interface Alert {
  id: string; name: string; branch: string; recruiter: string;
  sinceDate: string | null; daysOnHold: number | null;
  severity: 'critical' | 'high' | 'medium';
}
interface HubAlerts { alerts: Alert[] }

const BRANCHES = ['all', 'GGR', 'LKN', 'AHM', 'UK', 'Unassigned'];

function formatRecruiter(email: string) {
  return email.split('@')[0].split(/[._]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
}

const SEVERITY = {
  critical: { left: 'border-l-destructive',      badge: 'bg-destructive/10 text-destructive border-destructive/30',          icon: 'text-destructive',      label: 'Critical' },
  high:     { left: 'border-l-aurora-amber',     badge: 'bg-aurora-amber/10 text-aurora-amber border-aurora-amber/30',       icon: 'text-aurora-amber',     label: 'High'     },
  medium:   { left: 'border-l-aurora-amber',     badge: 'bg-aurora-amber/10 text-aurora-amber border-aurora-amber/30',       icon: 'text-aurora-amber',     label: 'Medium'   },
};

export default function AlertsTab() {
  const navigate = useNavigate();
  const { data, loading, error } = useHubFetch<HubAlerts>('hub-alerts');
  const [filterBranch, setFilterBranch] = useState('all');

  if (loading) return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
    </div>
  );

  if (error || !data) return (
    <div className="text-sm text-muted-foreground p-4">Failed to load alerts: {error}</div>
  );

  const alerts = filterBranch === 'all'
    ? data.alerts
    : data.alerts.filter(a => a.branch === filterBranch);

  const critical = data.alerts.filter(a => a.severity === 'critical').length;
  const high     = data.alerts.filter(a => a.severity === 'high').length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-1">
          <span className="font-medium">{data?.alerts?.length ?? 0} on Hold</span>
          {critical > 0 && <span className="text-destructive font-semibold">{critical} critical &gt;30d</span>}
          {high     > 0 && <span className="text-aurora-amber font-semibold">{high} high &gt;14d</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <Select value={filterBranch} onValueChange={setFilterBranch}>
            <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BRANCHES.map(b => (
                <SelectItem key={b} value={b} className="text-xs">
                  {b === 'all' ? 'All Branches' : b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">No Hold alerts for this branch.</div>
      ) : (
        <div className="space-y-2">
          {alerts.map(alert => {
            const s = SEVERITY[alert.severity];
            return (
              <Card key={alert.id} className={`border-l-4 ${s.left} cursor-pointer hover:bg-muted/40 transition-colors`} onClick={() => navigate(`/candidate/${alert.id}`)}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <AlertTriangle className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${s.icon}`} />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold leading-snug">{alert.name}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {alert.branch} · {formatRecruiter(alert.recruiter)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {alert.daysOnHold !== null && (
                        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${s.badge}`}>
                          <Clock className="h-3 w-3" />
                          {alert.daysOnHold}d
                        </div>
                      )}
                      <Badge variant="outline" className="text-[10px] px-1.5">{s.label}</Badge>
                    </div>
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
