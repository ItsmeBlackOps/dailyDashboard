import { useCallback, useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth, SOCKET_URL } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronsUpDown } from "lucide-react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { CartesianGrid, BarChart, Bar, XAxis, YAxis } from "recharts";
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
  roundByBranch?: Record<string, Record<string, number>>;
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

export function OverallInterviewsChart({
  data,
  config,
}: {
  data: Array<{ round: string; interviews: number }>;
  config: ChartConfig;
}) {
  return (
    <ChartContainer
      config={config}
      className="h-56 w-full rounded-xl border border-white/10 bg-white/5 backdrop-blur supports-[backdrop-filter]:bg-white/5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.3)]"
    >
      <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }} barCategoryGap={14}>
        <defs>
          <linearGradient id="glassy-interviews" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-interviews)" stopOpacity={0.85} />
            <stop offset="100%" stopColor="var(--color-interviews)" stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 4" vertical={false} />
        <XAxis dataKey="round" height={32} tickLine={false} axisLine={false} angle={-12} dy={12} tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} width={40} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="interviews" name="Interviews" fill="url(#glassy-interviews)" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

export function KpiOverview({ filters, role }: KpiOverviewProps) {
  const [kpi, setKpi] = useState<KpiPayload | null>(null);
  const [rangeLabel, setRangeLabel] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [selectedRounds, setSelectedRounds] = useState<Set<string>>(new Set());
  const [selectedBranches, setSelectedBranches] = useState<Set<string>>(new Set());
  const { refreshAccessToken } = useAuth();

  const allowCustomFetch = useMemo(() => {
    if (filters.upcoming) return true;
    if (filters.range !== "custom") return true;
    return Boolean(filters.start && filters.end);
  }, [filters]);

  const socket: Socket | null = useMemo(() => {
    if (typeof window === 'undefined') return null;
    const token = localStorage.getItem("accessToken") || "";
    return io(SOCKET_URL, {
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

  // Important: hooks must not be conditional. Compute branch-aware rounds early.
  const effectiveByRound = useMemo(() => {
    const payload = kpi;
    if (!payload) return {} as Record<string, number>;
    if (role === 'admin' && selectedBranches.size > 0 && payload.roundByBranch) {
      const acc = new Map<string, number>();
      for (const [branch, rounds] of Object.entries(payload.roundByBranch)) {
        if (!selectedBranches.has(branch)) continue;
        for (const [round, count] of Object.entries(rounds || {})) {
          acc.set(round, (acc.get(round) || 0) + (count || 0));
        }
      }
      return Object.fromEntries(acc.entries());
    }
    return payload.totals.byRound || {};
  }, [kpi, role, selectedBranches]);

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

  const roundEntries = Object.entries(effectiveByRound).sort((a, b) => b[1] - a[1]);
  const branchEntries = role === "admin"
    ? Object.entries(kpi.branch || {}).sort((a, b) => b[1] - a[1])
    : [];

  const filteredRoundEntries = roundEntries.filter(([round]) =>
    selectedRounds.size === 0 ? true : selectedRounds.has(round)
  );

  const overallChartData = filteredRoundEntries.map(([round, count]) => ({
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
        <CardHeader className="pb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="text-sm font-semibold text-primary">Overall Interviews</CardTitle>
            {rangeLabel && <p className="text-xs text-muted-foreground">{rangeLabel}</p>}
          </div>
          <div className="flex items-center gap-2">
            {/* Rounds multi-select */}
            <Popover>
              <PopoverTrigger asChild>
                <button className="inline-flex h-8 items-center justify-between whitespace-nowrap rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground">
                  {selectedRounds.size > 0 ? `Rounds (selected: ${selectedRounds.size})` : 'Rounds (filter)'}
                  <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0">
                <Command>
                  <CommandInput placeholder="Search rounds..." />
                  <CommandEmpty>No rounds found.</CommandEmpty>
                  <CommandList>
                    <CommandGroup>
                      {roundEntries
                        .map(([round]) => round)
                        .sort((a, b) => a.localeCompare(b))
                        .map((round) => {
                          const checked = selectedRounds.has(round);
                          return (
                            <CommandItem
                              key={round}
                              onSelect={() => {
                                const next = new Set(selectedRounds);
                                if (checked) next.delete(round); else next.add(round);
                                setSelectedRounds(next);
                              }}
                            >
                              <Checkbox checked={checked} className="mr-2 h-3.5 w-3.5" />
                              {round}
                            </CommandItem>
                          );
                        })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Branch multi-select (admin only) */}
            {role === 'admin' && (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="inline-flex h-8 items-center justify-between whitespace-nowrap rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground">
                    {selectedBranches.size > 0 ? `Branch (selected: ${selectedBranches.size})` : 'Branch (filter)'}
                    <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0">
                  <Command>
                    <CommandInput placeholder="Search branches..." />
                    <CommandEmpty>No branches found.</CommandEmpty>
                    <CommandList>
                      <CommandGroup>
                        {branchEntries
                          .map(([branch]) => branch)
                          .sort((a, b) => a.localeCompare(b))
                          .map((branch) => {
                            const checked = selectedBranches.has(branch);
                            return (
                              <CommandItem
                                key={branch}
                                onSelect={() => {
                                  const next = new Set(selectedBranches);
                                  if (checked) next.delete(branch); else next.add(branch);
                                  setSelectedBranches(next);
                                }}
                              >
                                <Checkbox checked={checked} className="mr-2 h-3.5 w-3.5" />
                                {branch}
                              </CommandItem>
                            );
                          })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <p className="text-3xl font-bold">{numberFormatter.format(filteredRoundEntries.reduce((acc, [, c]) => acc + (c ?? 0), 0))}</p>
            <span className="text-xs text-muted-foreground">
              {selectedRounds.size === 0 ? 'Total interviews across all rounds' : 'Total interviews across selected rounds'}
            </span>
          </div>

          {overallChartData.length > 0 ? (
            <OverallInterviewsChart data={overallChartData} config={overallChartConfig} />
          ) : (
            <p className="text-xs text-muted-foreground">No round breakdown available for this range.</p>
          )}

          {filteredRoundEntries.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 text-xs">
              {filteredRoundEntries.slice(0, 8).map(([round, count]) => (
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
              (selectedBranches.size > 0 ? branchEntries.filter(([b]) => selectedBranches.has(b)) : branchEntries)
                .map(([branch, count]) => (
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
