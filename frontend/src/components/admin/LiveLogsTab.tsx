import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Pause, Play, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/**
 * Live Intervue + Auto-Assign log viewer.
 *
 * Snapshot:    GET <LOGS_HOST>/logs?tail=200    (cheap, fast)
 * Stream:      GET <LOGS_HOST>/logs/stream      (SSE, browser-native EventSource)
 *
 * Snapshot fills the buffer on first paint (~1s); SSE streams new
 * lines as they happen. Both feeds share a single ring buffer of
 * MAX_LINES so memory stays bounded.
 */
const LOGS_HOST =
  import.meta.env.VITE_INTERVUE_LOGS_URL || 'https://emails.silverspace.tech';

const MAX_LINES = 1000;
type Container = 'intervue' | 'auto_assign';

interface LogLine {
  container: Container;
  line: string;
  // Local key — uniqueness across snapshot + stream merges.
  key: string;
}

interface SnapshotResponse {
  intervue: string[];
  auto_assign: string[];
}

const CONTAINER_STYLE: Record<Container, string> = {
  intervue:    'border-aurora-violet/40 text-aurora-violet bg-aurora-violet/5',
  auto_assign: 'border-emerald-500/40 text-emerald-400 bg-emerald-500/5',
};

const CONTAINER_LABEL: Record<Container, string> = {
  intervue:    'intervue',
  auto_assign: 'auto-assign',
};

export default function LiveLogsTab() {
  const [filter, setFilter] = useState<'all' | Container>('all');
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'live' | 'reconnecting' | 'closed'>('connecting');
  const containerRef = useRef<HTMLDivElement>(null);
  const keyCounterRef = useRef(0);

  const newKey = () => `k${++keyCounterRef.current}`;

  // ── Snapshot ────────────────────────────────────────────────────
  const { data: snapshot, isLoading: snapLoading, error: snapError } = useQuery<SnapshotResponse>({
    queryKey: ['intervue-logs-snapshot'],
    queryFn: async () => {
      const res = await fetch(`${LOGS_HOST}/logs?tail=200`, { credentials: 'omit' });
      if (!res.ok) throw new Error(`snapshot ${res.status}`);
      return res.json();
    },
    staleTime: Infinity, // we fold updates into the buffer ourselves via SSE
    gcTime: Infinity,
    retry: 1,
  });

  useEffect(() => {
    if (!snapshot) return;
    // Defensive: API may return a different shape than expected (string,
    // null, error envelope). Only consume the two array fields we need.
    const intervue    = Array.isArray(snapshot.intervue)    ? snapshot.intervue    : [];
    const autoAssign  = Array.isArray(snapshot.auto_assign) ? snapshot.auto_assign : [];
    const seed: LogLine[] = [];
    for (const l of intervue)   if (typeof l === 'string') seed.push({ container: 'intervue',    line: l, key: newKey() });
    for (const l of autoAssign) if (typeof l === 'string') seed.push({ container: 'auto_assign', line: l, key: newKey() });
    setLines(seed);
  }, [snapshot]);

  // ── SSE stream ──────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource(`${LOGS_HOST}/logs/stream`);
    setStreamStatus('connecting');

    es.onopen = () => setStreamStatus('live');
    es.onerror = () => {
      // Browser auto-reconnects; just surface state.
      setStreamStatus('reconnecting');
    };
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.ping) return;
        if (!msg.container || !msg.line) return;
        setLines((prev) => {
          const next = prev.concat({
            container: msg.container as Container,
            line: msg.line,
            key: newKey(),
          });
          return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
        });
      } catch {
        // malformed event → ignore
      }
    };

    return () => {
      es.close();
      setStreamStatus('closed');
    };
  }, []);

  // ── Filtering ───────────────────────────────────────────────────
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((l) => {
      if (filter !== 'all' && l.container !== filter) return false;
      if (q && !l.line.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lines, filter, query]);

  const counts = useMemo(() => ({
    intervue:    lines.filter((l) => l.container === 'intervue').length,
    auto_assign: lines.filter((l) => l.container === 'auto_assign').length,
  }), [lines]);

  // ── Auto-scroll ─────────────────────────────────────────────────
  useEffect(() => {
    if (paused || !containerRef.current) return;
    const el = containerRef.current;
    el.scrollTop = el.scrollHeight;
  }, [visible, paused]);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        {/* Status + controls row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span
              className={
                'h-2 w-2 rounded-full ' +
                (streamStatus === 'live' ? 'bg-emerald-400 animate-pulse'
                : streamStatus === 'reconnecting' ? 'bg-amber-400 animate-pulse'
                : streamStatus === 'closed' ? 'bg-muted-foreground'
                : 'bg-sky-400 animate-pulse')
              }
            />
            <span className="text-muted-foreground">{streamStatus}</span>
          </span>

          <Button
            size="sm"
            variant={filter === 'all' ? 'default' : 'outline'}
            onClick={() => setFilter('all')}
            className="text-xs h-7"
          >
            All ({lines.length})
          </Button>
          <Button
            size="sm"
            variant={filter === 'intervue' ? 'default' : 'outline'}
            onClick={() => setFilter('intervue')}
            className="text-xs h-7"
          >
            Intervue ({counts.intervue})
          </Button>
          <Button
            size="sm"
            variant={filter === 'auto_assign' ? 'default' : 'outline'}
            onClick={() => setFilter('auto_assign')}
            className="text-xs h-7"
          >
            Auto-Assign ({counts.auto_assign})
          </Button>

          <Input
            placeholder="Filter text…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="text-xs h-7 max-w-[260px] ml-auto"
          />

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPaused((p) => !p)}
            className="text-xs h-7 gap-1"
            title={paused ? 'Resume auto-scroll' : 'Pause auto-scroll'}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setLines([])}
            className="text-xs h-7 gap-1"
            title="Clear buffer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Stream viewport */}
        <div
          ref={containerRef}
          className="font-mono text-[11px] bg-black/40 rounded-lg border border-white/[0.06] h-[60vh] overflow-y-auto p-2 leading-relaxed"
        >
          {snapLoading && lines.length === 0 && (
            <div className="text-muted-foreground text-center py-10 flex flex-col items-center gap-2">
              <Activity className="h-5 w-5 animate-pulse" />
              Loading snapshot…
            </div>
          )}
          {snapError && lines.length === 0 && (
            <div className="text-destructive text-center py-10">
              Snapshot failed: {String((snapError as Error).message)}
            </div>
          )}
          {!snapLoading && lines.length > 0 && visible.length === 0 && (
            <div className="text-muted-foreground text-center py-10">
              No log lines match the filter
            </div>
          )}

          {visible.map((l) => (
            <div key={l.key} className="flex items-start gap-2 hover:bg-white/[0.02] px-1 -mx-1 rounded">
              <Badge
                variant="outline"
                className={`text-[9px] font-semibold shrink-0 mt-[1px] ${CONTAINER_STYLE[l.container]}`}
              >
                {CONTAINER_LABEL[l.container]}
              </Badge>
              <span className="text-foreground/85 whitespace-pre-wrap break-all">
                {l.line}
              </span>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-muted-foreground">
          Source: <span className="font-mono">{LOGS_HOST}</span> · buffer caps at {MAX_LINES} lines
        </p>
      </CardContent>
    </Card>
  );
}
