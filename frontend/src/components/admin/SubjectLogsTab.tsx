import { useEffect, useMemo, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth, API_URL } from '@/hooks/useAuth';

interface AuditRow {
  _id: string;
  subject: string;
  phase?: string;
  action?: string;          // older rows used `action` instead of `phase`
  detail?: string;
  level?: 'info' | 'warning' | 'error';
  createdAt: string;
  extra?: Record<string, unknown>;
  response_body_preview?: string;
  error_details?: string;
  // tolerated extra keys
  [key: string]: unknown;
}

const PHASE_STYLE: Record<string, string> = {
  RECEIVED:              'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  EXTRACTED:             'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  CREATED:               'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  AUTO_ASSIGN_QUEUED:    'bg-sky-500/15 text-sky-300 border-sky-500/30',
  AUTO_ASSIGN_STARTED:   'bg-sky-500/15 text-sky-300 border-sky-500/30',
  AUTO_ASSIGN_LOOKUP:    'bg-sky-500/15 text-sky-300 border-sky-500/30',
  AUTO_ASSIGN_SENT:      'bg-amber-500/15 text-amber-300 border-amber-500/30',
  AUTO_ASSIGN_SUCCESS:   'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  AUTO_ASSIGN_FAILED:    'bg-red-500/15 text-red-300 border-red-500/30',
  AUTO_ASSIGN_5XX:       'bg-red-500/15 text-red-300 border-red-500/30',
  AUTO_ASSIGN_SKIPPED:   'bg-slate-500/15 text-slate-300 border-slate-500/30',
  REPLY_RECEIVED:        'bg-slate-500/15 text-slate-300 border-slate-500/30',
  DUPLICATE_DETECTED:    'bg-amber-500/15 text-amber-300 border-amber-500/30',
  STATUS_CHANGED:        'bg-slate-500/15 text-slate-300 border-slate-500/30',
  STATUS_CHANGE_FAILED:  'bg-red-500/15 text-red-300 border-red-500/30',
  SKIPPED:               'bg-muted text-muted-foreground border-border',
  PUSHED_TO_KAFKA:       'bg-aurora-violet/15 text-aurora-violet border-aurora-violet/30',
  REPROCESS_TRIGGERED:   'bg-aurora-violet/15 text-aurora-violet border-aurora-violet/30',
};

function phaseClass(phase: string): string {
  return PHASE_STYLE[phase] ?? 'bg-muted text-muted-foreground border-border';
}

function fmt(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function SubjectLogsTab() {
  const { authFetch } = useAuth();
  const [params, setParams] = useSearchParams();
  const initial = params.get('subject') ?? '';
  const [draft, setDraft] = useState(initial);
  const [active, setActive] = useState(initial);
  const [openRow, setOpenRow] = useState<string | null>(null);

  // keep URL in sync so the Tasks page deep-link works on reload
  useEffect(() => {
    if (active && params.get('subject') !== active) {
      const next = new URLSearchParams(params);
      next.set('subject', active);
      setParams(next, { replace: true });
    }
  }, [active, params, setParams]);

  const { data, isLoading, refetch } = useQuery<{ success: boolean; subject: string; rows: AuditRow[] }>({
    queryKey: ['subject-audit', active],
    enabled: !!active,
    queryFn: async () => {
      const res = await authFetch(
        `${API_URL}/api/admin/interview-support/audit?subject=${encodeURIComponent(active)}&limit=300`
      );
      if (!res.ok) throw new Error('Failed to load audit logs');
      return res.json();
    },
    // Pause polling when this tab/page is hidden — saves both API
    // round-trips and battery on idle dashboards.
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'visible' ? 5000 : false,
    refetchIntervalInBackground: false,
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input
          placeholder="Paste full subject — e.g. Interview Support - Sai Sumanth Chaluvadi - Business Analyst..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setActive(draft.trim())}
          className="text-xs"
        />
        <Button
          size="sm"
          onClick={() => setActive(draft.trim())}
          disabled={!draft.trim()}
        >
          Load logs
        </Button>
        {active && (
          <Button size="sm" variant="ghost" onClick={() => refetch()}>
            Refresh
          </Button>
        )}
      </div>

      {!active && (
        <p className="text-xs text-muted-foreground py-12 text-center">
          Enter a subject above to see the unified Intervue + Auto-Assign timeline.
        </p>
      )}

      {active && isLoading && (
        <p className="text-xs text-muted-foreground py-8 text-center">Loading…</p>
      )}

      {active && !isLoading && rows.length === 0 && (
        <p className="text-xs text-muted-foreground py-8 text-center">
          No audit entries for this subject yet.
        </p>
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <ScrollArea className="h-[640px]">
              <ol className="relative border-l border-border ml-3 my-3">
                {rows.map((r) => {
                  const phase = r.phase || r.action || 'UNKNOWN';
                  const expanded = openRow === r._id;
                  const hasDetails =
                    r.extra ||
                    r.response_body_preview ||
                    r.error_details ||
                    (r.level && r.level !== 'info');

                  return (
                    <li key={r._id} className="ml-4 mb-3">
                      <span
                        className={`absolute -left-[7px] flex h-3 w-3 items-center justify-center rounded-full border ${phaseClass(phase)}`}
                        aria-hidden
                      />
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={`text-[10px] ${phaseClass(phase)}`}>
                          {phase}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">{fmt(r.createdAt)}</span>
                        {r.level === 'error' && (
                          <Badge variant="destructive" className="text-[10px]">error</Badge>
                        )}
                        {r.level === 'warning' && (
                          <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">warn</Badge>
                        )}
                        {hasDetails && (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="h-5 px-1"
                            onClick={() => setOpenRow(expanded ? null : r._id)}
                          >
                            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            <span className="text-[10px]">details</span>
                          </Button>
                        )}
                      </div>
                      {r.detail && (
                        <p className="text-xs text-foreground mt-1 leading-snug">{r.detail}</p>
                      )}
                      {expanded && (
                        <pre className="text-[10.5px] mt-2 p-2 rounded border bg-muted/40 overflow-x-auto whitespace-pre-wrap break-all">
{JSON.stringify(
  {
    extra: r.extra,
    response_body_preview: r.response_body_preview,
    error_details: r.error_details,
  },
  null,
  2
)}
                        </pre>
                      )}
                    </li>
                  );
                })}
              </ol>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
