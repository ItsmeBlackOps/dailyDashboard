import { useCallback, useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth, API_URL } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import type { DashboardFilterState } from "./DashboardFilters";
import { buildDashboardPayload } from "./dashboardUtils";

interface KpiPayload {
  totals: {
    overall: number;
    byRound: Record<string, number>;
  };
  received: {
    today: number;
    thisWeek: number;
    thisMonth: number;
  };
  interview: {
    today: number;
    thisWeek: number;
    thisMonth: number;
  };
  branch?: Record<string, number>;
}

interface DashboardSummaryResponse {
  success: boolean;
  summary?: unknown[];
  meta?: {
    kpi?: KpiPayload;
    dateRange?: {
      startIso?: string;
      endIso?: string;
      range?: string;
    };
  };
  error?: string;
}

interface KpiOverviewProps {
  filters: DashboardFilterState;
  role: string;
}

const shorthand = new Intl.NumberFormat("en-US", { notation: "compact" });
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const roundBadgeClass = (label: string) => {
  const key = label.trim().toLowerCase();
  if (key.startsWith("1")) return "bg-emerald-500 text-white";
  if (key.startsWith("2")) return "bg-blue-500 text-white";
  if (key.startsWith("3")) return "bg-purple-500 text-white";
  if (key.includes("final")) return "bg-amber-500 text-white";
  return "bg-gray-600 text-white";
};

export function KpiOverview({ filters, role }: KpiOverviewProps) {
  const [kpi, setKpi] = useState<KpiPayload | null>(null);
  const [rangeLabel, setRangeLabel] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const { refreshAccessToken } = useAuth();

  const allowCustomFetch = useMemo(() => {
    if (filters.range !== "custom") return true;
    return Boolean(filters.start && filters.end);
  }, [filters]);

  const socket: Socket | null = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const token = localStorage.getItem("accessToken") || "";
    return io(API_URL, {
      autoConnect: false,
      transports: ["websocket"],
      auth: { token },
    });
  }, []);

  const fetchKpi = useCallback(() => {
    if (!socket) return;
    if (!allowCustomFetch) {
      setError("Select both start and end dates for a custom range");
      setKpi(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    socket.emit("getDashboardSummary", buildDashboardPayload(filters), (resp: DashboardSummaryResponse) => {
      if (!resp || !resp.success) {
        setError(resp?.error || "Unable to load KPIs");
        setKpi(null);
        setRangeLabel("");
        setLoading(false);
        return;
      }

      try {
        const overall = resp.meta?.kpi?.totals?.overall ?? 0;
        console.log('[dashboard:kpi]', JSON.stringify({ overall }));
      } catch (logError) {
        console.log('[dashboard:kpi] unable to log KPI payload', logError);
      }

      setKpi(resp.meta?.kpi ?? null);
      const rangeMeta = resp.meta?.dateRange;
      if (rangeMeta?.startIso && rangeMeta?.endIso) {
        const from = new Date(rangeMeta.startIso).toLocaleDateString();
        const to = new Date(rangeMeta.endIso).toLocaleDateString();
        const descriptor = rangeMeta.range ? rangeMeta.range.toUpperCase() : "CUSTOM";
        setRangeLabel(`${descriptor}: ${from} → ${to}`);
      } else {
        setRangeLabel("");
      }
      setLoading(false);
    });
  }, [socket, filters, allowCustomFetch]);

  useEffect(() => {
    if (!socket) return;
    const handleConnect = () => fetchKpi();
    const handleDisconnect = (reason: string) => {
      console.debug("[KpiOverview] socket disconnected", reason);
    };
    const handleError = async (err: Error) => {
      if (err.message !== "Unauthorized") return;
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        setError("Session expired. Please sign in again.");
        return;
      }
      socket.auth = { token: localStorage.getItem("accessToken") || "" };
      socket.once("connect", fetchKpi);
      socket.connect();
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleError);

    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleError);
      socket.disconnect();
    };
  }, [socket, fetchKpi, refreshAccessToken]);

  useEffect(() => {
    if (socket && socket.connected) {
      fetchKpi();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.range, filters.dateField, filters.start, filters.end]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: role === "admin" ? 5 : 4 }).map((_, idx) => (
          <Skeleton key={idx} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/60 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-destructive">Dashboard KPIs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!kpi) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dashboard KPIs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No KPI data available.</p>
        </CardContent>
      </Card>
    );
  }

  const roundEntries = Object.entries(kpi.totals.byRound || {}).sort((a, b) => b[1] - a[1]);
  const branchEntries = role === "admin"
    ? Object.entries(kpi.branch || {}).sort((a, b) => b[1] - a[1])
    : [];

  const overallChartData = roundEntries.map(([round, count]) => ({
    round,
    interviews: count,
  }));

  const overallChartConfig: ChartConfig = {
    interviews: {
      label: "Interviews",
      color: "hsl(var(--primary))",
    },
  };

  return (
    <div className="grid gap-4">
      <Card className="bg-gradient-to-br from-primary/15 via-background to-background border-primary/40 shadow-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-primary">Overall Interviews</CardTitle>
          {rangeLabel && <p className="text-xs text-muted-foreground">{rangeLabel}</p>}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <p className="text-3xl font-bold">{numberFormatter.format(kpi.totals.overall)}</p>
            <span className="text-xs text-muted-foreground">Total interviews across all rounds</span>
          </div>

          {overallChartData.length > 0 ? (
            <ChartContainer config={overallChartConfig} className="h-56 w-full">
              <LineChart data={overallChartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="round" height={32} tickLine={false} axisLine={false} angle={-12} dy={12} tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} width={40} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  type="monotone"
                  dataKey="interviews"
                  stroke="var(--color-interviews)"
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ChartContainer>
          ) : (
            <p className="text-xs text-muted-foreground">No round breakdown available for this range.</p>
          )}

          {roundEntries.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 text-xs">
              {roundEntries.slice(0, 8).map(([round, count]) => (
                <div key={round} className="flex items-center justify-between rounded-md border border-border/60 px-2 py-1">
                  <Badge className={`${roundBadgeClass(round)} text-[10px]`}>{round}</Badge>
                  <span className="font-medium">{numberFormatter.format(count)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {role === "admin" && (
        <Card className="bg-muted/10 backdrop-blur border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Branch Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {branchEntries.length === 0 ? (
              <p className="text-muted-foreground text-sm">No branch data.</p>
            ) : (
              branchEntries.map(([branch, count]) => (
                <div key={branch} className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
                  <span className="font-medium">{branch}</span>
                  <span>{shorthand.format(count)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
