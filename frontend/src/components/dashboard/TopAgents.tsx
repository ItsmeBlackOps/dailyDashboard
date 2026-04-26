import { useEffect, useMemo, useState, useCallback } from "react";
import { usePostHog } from 'posthog-js/react';
import { io, Socket } from "socket.io-client";
import { useAuth, SOCKET_URL } from "@/hooks/useAuth";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { CartesianGrid, XAxis, YAxis, BarChart, Bar } from "recharts";
import type { DashboardFilterState } from "./DashboardFilters";
import { buildDashboardPayload } from "./dashboardUtils";
import { cn } from "@/lib/utils";

interface LeaderResponse {
  id: string;
  name: string;
  counts: Record<string, number>;
  total: number;
  highlight?: boolean;
}

interface LeadersPayload {
  expert: LeaderResponse[];
  recruiter: LeaderResponse[];
  candidate: LeaderResponse[];
}

interface DashboardSummaryResponse {
  success: boolean;
  summary?: unknown[];
  meta?: {
    leaders?: LeadersPayload;
  };
  error?: string;
}

type ViewMode = "expert" | "recruiter" | "candidate";

type TopAgentsProps = {
  filters: DashboardFilterState;
  role: string;
};

// Removed display mode (All/Top10/Top10+Others). Always show all with agent filter.

function humanizeName(input?: string): string {
  if (!input) return "Unknown";
  let s = String(input).trim();
  if (s.includes("@")) s = s.split("@")[0];
  const parts = s.split(/[._\s-]+/).filter(Boolean);
  if (parts.length === 0) return "Unknown";
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function roundBadgeClass(round: string) {
  const key = round.trim().toLowerCase();
  if (key.startsWith("1")) return "bg-aurora-emerald text-white";
  if (key.startsWith("2")) return "bg-primary text-white";
  if (key.startsWith("3")) return "bg-aurora-violet text-white";
  if (key.includes("final")) return "bg-aurora-amber text-white";
  return "bg-muted-foreground text-white";
}

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function TopAgentsChart({
  rounds,
  data,
  leaders: leadersForChart,
  config,
}: {
  rounds: string[];
  data: Array<Record<string, number | string>>;
  leaders: LeaderResponse[];
  config: ChartConfig;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const SortedTooltip = (props: any) => {
    const sorted = Array.isArray(props.payload)
      ? [...props.payload].sort((a, b) => (b?.value || 0) - (a?.value || 0))
      : props.payload;
    return (
      <ChartTooltipContent
        {...props}
        payload={sorted}
        indicator="dot"
        hideLabel={false}
      />
    );
  };

  return (
    <>
      <ChartContainer
        config={config}
        className="relative h-56 w-full rounded-xl border border-white/10 bg-white/5 backdrop-blur supports-[backdrop-filter]:bg-white/5 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.3)]"
      >
        <BarChart
          data={data}
          margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
          barGap={6}
          barCategoryGap={12}
        >
          <defs>
            {leadersForChart.map((_, index) => {
              const key = `series_${index}`;
              const id = `glassy-${key}`;
              return (
                <linearGradient key={id} id={id} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity={0.45} />
                  <stop offset="20%" stopColor={`var(--color-${key})`} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={`var(--color-${key})`} stopOpacity={0.35} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid strokeDasharray="4 4" vertical={false} />
          <XAxis dataKey="round" height={32} tickLine={false} axisLine={false} dy={12} tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} width={40} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
          {/* Tooltip acts as hover-only legend for the active stack (sorted) */}
          <ChartTooltip content={<SortedTooltip />} />
          {leadersForChart.map((leader, index) => {
            const key = `series_${index}`;
            return (
              <Bar
                key={key}
                dataKey={key}
                name={leader.name}
                fill={`url(#glassy-${key})`}
                radius={[6, 6, 0, 0]}
                stackId="stack"
                stroke="rgba(255,255,255,0.25)"
                strokeWidth={1}
                style={{ filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.08))" }}
                onMouseEnter={() => setHoveredKey(key)}
                onMouseLeave={() => setHoveredKey(null)}
                fillOpacity={hoveredKey && hoveredKey !== key ? 0.35 : 1}
              />
            );
          })}
        </BarChart>
      </ChartContainer>
      {/* Color legend removed per request. Tooltip remains for values. */}
    </>
  );
}

export function TopAgents({ filters, role }: TopAgentsProps) {
  const [leaders, setLeaders] = useState<LeadersPayload>({
    expert: [],
    recruiter: [],
    candidate: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { refreshAccessToken } = useAuth();
  const posthog = usePostHog();


  // const [displayMode, setDisplayMode] = useState<DisplayMode>("all");

  const allowedViews: ViewMode[] = useMemo(() => {
    if (role === "admin") return ["expert", "recruiter", "candidate"];
    if (role === "MM" || role === "MAM" || role === "mlead") return ["recruiter", "candidate"];
    if (role === "lead") return ["expert", "candidate"];
    return ["candidate"];
  }, [role]);

  const [view, setView] = useState<ViewMode>(allowedViews[0]);
  const [agentFilter, setAgentFilter] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!allowedViews.includes(view)) {
      setView(allowedViews[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedViews.join("|")]);

  const allowCustomFetch = useMemo(() => {
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

  const fetchLeaders = useCallback(() => {
    if (!socket) return;
    if (!allowCustomFetch) {
      setError("Select both start and end dates for a custom range");
      setLeaders({ expert: [], recruiter: [], candidate: [] });
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    socket.emit("getDashboardSummary", buildDashboardPayload(filters), (resp: DashboardSummaryResponse) => {
      if (!resp || !resp.success) {
        setError(resp?.error || "Failed to load leaders");
        setLeaders({ expert: [], recruiter: [], candidate: [] });
        setLoading(false);
        return;
      }

      const payload = resp.meta?.leaders ?? { expert: [], recruiter: [], candidate: [] };
      setLeaders({
        expert: payload.expert || [],
        recruiter: payload.recruiter || [],
        candidate: payload.candidate || [],
      });
      setLoading(false);
    });
  }, [socket, filters, allowCustomFetch]);

  useEffect(() => {
    if (!socket) return;
    const onConnect = () => {
      fetchLeaders();
    };
    const onDisconnect = (reason: string) => {
      console.debug("[TopAgents] socket disconnected:", reason);
    };
    const onAuthError = async (err: Error) => {
      if (err.message !== "Unauthorized") return;
      const ok = await refreshAccessToken();
      if (!ok) {
        setError("Session expired. Please sign in again.");
        return;
      }
      socket.auth = { token: localStorage.getItem("accessToken") || "" };
      socket.once("connect", fetchLeaders);
      socket.connect();
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onAuthError);

    socket.connect();
    const interval = setInterval(fetchLeaders, 60_000);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onAuthError);
      socket.disconnect();
      clearInterval(interval);
    };
  }, [socket, fetchLeaders, refreshAccessToken]);

  useEffect(() => {
    if (socket && socket.connected) {
      fetchLeaders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.range, filters.dateField, filters.start, filters.end]);

  const viewLabel: Record<ViewMode, string> = {
    expert: "Expert Wise",
    recruiter: "Recruiter Wise",
    candidate: "Candidate Wise",
  };

  const list = useMemo(() => {
    const combined = leaders[view] || [];
    if (agentFilter.size === 0) return combined;
    return combined.filter((l) => agentFilter.has(l.id));
  }, [leaders, view, agentFilter]);

  useEffect(() => {
    posthog.capture('dashboard_top_agents_viewed', {
      user_role: role,
      view_mode: view,
      agents_count: list.length,
      agent_search_active: agentFilter.size > 0
    });
  }, [view, agentFilter, list.length, role, posthog]);

  const rowHighlightClasses = useCallback((leader: LeaderResponse) => {
    if (leader.highlight) {
      return "bg-gradient-to-r from-red-500/15 via-transparent to-transparent border-red-500/40 shadow-[0_0_24px_rgba(239,68,68,0.15)]";
    }
    return "bg-muted/10 border-border/60";
  }, []);

  const topLeadersForChart = useMemo(() => {
    // Always use all leaders (sorted by total desc)
    return [...list].sort((a, b) => b.total - a.total);
  }, [list]);

  const chartRounds = useMemo(() => {
    const rounds = new Set<string>();
    topLeadersForChart.forEach((leader) => {
      Object.keys(leader.counts || {}).forEach((round) => rounds.add(round));
    });
    return Array.from(rounds).sort((a, b) => a.localeCompare(b));
  }, [topLeadersForChart]);

  const chartData = useMemo(() => {
    return chartRounds.map((round) => {
      const entry: Record<string, number | string> = { round };
      topLeadersForChart.forEach((leader, index) => {
        const key = `series_${index}`;
        entry[key] = leader.counts?.[round] ?? 0;
      });
      return entry;
    });
  }, [chartRounds, topLeadersForChart]);

  const chartConfig = useMemo<ChartConfig>(() => {
    const n = Math.max(1, topLeadersForChart.length);
    return topLeadersForChart.reduce((acc, leader, index) => {
      const key = `series_${index}`;
      // Softer palette for a more refined (less childish) look
      const hue = Math.round((index / n) * 360);
      const color = `hsl(${hue}, 55%, 45%)`;
      acc[key] = {
        label: leader.name,
        color,
      };
      return acc;
    }, {} as ChartConfig);
  }, [topLeadersForChart]);


  return (
    <Card className="dashboard-card h-auto">
      <CardHeader className="mb-1 p-0 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <CardTitle className="text-lg font-medium">Top Performing Agents</CardTitle>
          <CardDescription className="text-xs">
            {viewLabel[view]} · {list.length} {view === 'candidate' ? 'candidates' : 'agents'} · {numberFormatter.format(list.reduce((acc, item) => acc + item.total, 0))} interviews
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {allowedViews.length > 1 ? (
            <Select value={view} onValueChange={(v: ViewMode) => setView(v)}>
              <SelectTrigger className="w-44 h-8">
                <SelectValue placeholder="Select view" />
              </SelectTrigger>
              <SelectContent>
                {allowedViews.map((v) => (
                  <SelectItem key={v} value={v}>
                    {viewLabel[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="outline" className="text-xs">
              {viewLabel[allowedViews[0]]}
            </Badge>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button className="inline-flex h-8 items-center justify-between whitespace-nowrap rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground">
                {agentFilter.size > 0 ? `Agents (selected: ${agentFilter.size})` : 'Agents (filter)'}
                <ChevronsUpDown className="ml-2 h-3 w-3 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0">
              <Command>
                <CommandInput placeholder="Search agents..." />
                <CommandEmpty>No agents found.</CommandEmpty>
                <CommandList>
                  <CommandGroup>
                    {(leaders[view] || [])
                      .map((l) => ({ id: l.id, name: humanizeName(l.name) }))
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map(({ id, name }) => {
                        const checked = agentFilter.has(id);
                        return (
                          <CommandItem
                            key={id}
                            onSelect={() => {
                              const next = new Set(agentFilter);
                              if (checked) next.delete(id); else next.add(id);
                              setAgentFilter(next);
                            }}
                          >
                            <Checkbox checked={checked} className="mr-2 h-3.5 w-3.5" />
                            {name}
                          </CommandItem>
                        );
                      })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 px-0 pt-2">
        {loading ? (
          <p className="text-sm text-muted-foreground px-1">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive px-1">{error}</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground px-1">No data for the selected filters.</p>
        ) : (
          <>
            {chartData.length > 0 && chartRounds.length > 0 && topLeadersForChart.length > 0 && (
              <div className="px-1">
                <TopAgentsChart rounds={chartRounds} data={chartData} leaders={topLeadersForChart} config={chartConfig} />
              </div>
            )}

            <div className="max-h-[28rem] overflow-y-auto pr-2 space-y-3">
              {list.map((leader, index) => {
                const entries = Object.entries(leader.counts)
                  .filter(([, value]) => (value ?? 0) > 0)
                  .sort((a, b) => {
                    const diff = (b[1] ?? 0) - (a[1] ?? 0);
                    return diff !== 0 ? diff : a[0].localeCompare(b[0]);
                  });

                return (
                  <div
                    key={leader.id}
                    className={cn(
                      "flex items-center gap-4 rounded-xl border border-border/60 bg-muted/5 p-3 transition-all",
                      rowHighlightClasses(leader)
                    )}
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarImage alt={leader.name} />
                      <AvatarFallback>{initialsFrom(leader.name)}</AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center gap-2 mb-1">
                        <div className="flex flex-col">
                          <p className="text-sm font-medium truncate">{humanizeName(leader.name)}</p>
                          {leader.highlight && (
                            <span className="text-[10px] text-primary font-semibold uppercase tracking-wide">
                              {index === 0 ? 'Top performer' : 'Attention required'}
                            </span>
                          )}
                        </div>
                        <Badge variant="secondary" className="text-[10px]">
                          {numberFormatter.format(leader.total)} total
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {entries.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No round data available.</span>
                        ) : (
                          entries.map(([label, count]) => (
                            <Badge key={label} className={`${roundBadgeClass(label)} text-xs`}>
                              {label}: {numberFormatter.format(count)}
                            </Badge>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
