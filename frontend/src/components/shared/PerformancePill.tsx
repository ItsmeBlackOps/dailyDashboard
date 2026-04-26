import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface PerfState { feMs?: number; beMs?: number; }

export default function PerformancePill() {
  const [perf, setPerf] = useState<PerfState>({});

  useEffect(() => {
    const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const feMs = navEntry ? Math.round(navEntry.domContentLoadedEventEnd - navEntry.startTime) : undefined;
    setPerf(p => ({ ...p, feMs }));

    if (!(window as any).__perfPatched) {
      (window as any).__perfPatched = true;
      const origFetch = window.fetch;
      const samples: number[] = [];
      window.fetch = async (...args) => {
        const start = performance.now();
        const res = await origFetch(...args);
        const beHeader = res.headers.get('X-Response-Time-Ms');
        const beMs = beHeader ? parseInt(beHeader, 10) : Math.round(performance.now() - start);
        samples.push(beMs);
        if (samples.length > 20) samples.shift();
        const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
        window.dispatchEvent(new CustomEvent('perf-update', { detail: { beMs: avg } }));
        return res;
      };
    }

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setPerf(p => ({ ...p, beMs: detail.beMs }));
    };
    window.addEventListener('perf-update', handler);
    return () => window.removeEventListener('perf-update', handler);
  }, []);

  if (!perf.feMs && !perf.beMs) return null;

  const color = (ms?: number) =>
    !ms ? 'text-muted-foreground' :
    ms < 200 ? 'text-aurora-emerald' :
    ms < 500 ? 'text-aurora-amber' : 'text-aurora-rose';

  return (
    <Badge
      variant="outline"
      className="gap-2 font-mono text-xs px-2 py-1 hidden md:inline-flex"
      title="Page load + average backend response"
    >
      <Activity className="h-3 w-3 opacity-70" />
      {perf.feMs && <span className={color(perf.feMs)}>{perf.feMs}ms FE</span>}
      {perf.beMs && (
        <>
          <span className="text-muted-foreground">·</span>
          <span className={color(perf.beMs)}>{perf.beMs}ms BE</span>
        </>
      )}
    </Badge>
  );
}
