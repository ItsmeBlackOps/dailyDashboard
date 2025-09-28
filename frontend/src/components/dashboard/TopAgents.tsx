import { useEffect, useMemo, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth, API_URL } from "@/hooks/useAuth";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
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

/**
 * Formats a raw name or email/local-part into a human-readable, capitalized name.
 *
 * Splits on dots, underscores, hyphens, and spaces, capitalizes each part, and joins with spaces. If `input` is an email, the local-part (before `@`) is used. Empty or missing inputs yield `"Unknown"`.
 *
 * @param input - A raw name string or an email address; may be undefined.
 * @returns The humanized name (e.g., `john.doe@example.com` → `John Doe`) or `"Unknown"` if no usable input is provided.
 */
function humanizeName(input?: string): string {
  if (!input) return "Unknown";
  let s = String(input).trim();
  if (s.includes("@")) s = s.split("@")[0];
  const parts = s.split(/[._\s-]+/).filter(Boolean);
  if (parts.length === 0) return "Unknown";
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
}

/**
 * Create a two-character initials string from a person's name.
 *
 * @param name - The full name to derive initials from; may contain extra spaces or be empty.
 * @returns `'NA'` if `name` is empty or only whitespace, otherwise a two-character uppercase initials string:
 * - For a single word, the first two characters of that word uppercased.
 * - For multiple words, the first letter of the first and last word uppercased.
 */
function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Maps a round name to the CSS classes used for that round's badge color and text.
 *
 * @param round - The round label (e.g., "1st", "2", "Final"); whitespace and case are ignored.
 * @returns The CSS class string to apply for the badge (background color and text color).
 */
function roundBadgeClass(round: string) {
  const key = round.trim().toLowerCase();
  if (key.startsWith("1")) return "bg-emerald-600 text-white";
  if (key.startsWith("2")) return "bg-blue-600 text-white";
  if (key.startsWith("3")) return "bg-purple-600 text-white";
  if (key.includes("final")) return "bg-amber-600 text-white";
  return "bg-slate-600 text-white";
}

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * Render a "Top Performing Agents" dashboard card that displays a chart and ranked list of agents (experts, recruiters, or candidates) based on the provided filters and user role.
 *
 * The component retrieves leader data over a websocket, refreshes data periodically, and attempts to refresh the session token on authorization errors. Visible views and selectable perspectives are determined by `role`.
 *
 * @param filters - Dashboard filter state that controls date range, date field, and other query parameters used to fetch leaders.
 * @param role - Current user's role; determines which views (expert, recruiter, candidate) are available.
 * @returns A React element containing the card UI with chart, leader list, loading/error/empty states, and view selection. 
 */
export function TopAgents({ filters, role }: TopAgentsProps) {
  const [leaders, setLeaders] = useState<LeadersPayload>({
    expert: [],
    recruiter: [],
    candidate: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { refreshAccessToken } = useAuth();

  const allowedViews: ViewMode[] = useMemo(() => {
    if (role === "admin") return ["expert", "recruiter", "candidate"];
    if (role === "MM" || role === "MAM" || role === "mlead") return ["recruiter", "candidate"];
    if (role === "lead") return ["expert", "candidate"];
    return ["candidate"];
  }, [role]);

  const [view, setView] = useState<ViewMode>(allowedViews[0]);

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
    return io(API_URL, {
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
    return leaders[view] || [];
  }, [leaders, view]);

  const rowHighlightClasses = useCallback((leader: LeaderResponse) => {
    if (leader.highlight) {
      return "bg-gradient-to-r from-red-500/15 via-transparent to-transparent border-red-500/40 shadow-[0_0_24px_rgba(239,68,68,0.15)]";
    }
    return "bg-muted/10 border-border/60";
  }, []);

  const topLeadersForChart = useMemo(() => list.slice(0, 5), [list]);

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
    const palette = [
      "hsl(var(--primary))",
      "hsl(var(--secondary))",
      "hsl(var(--accent))",
      "#12a8f8",
      "#f97316",
    ];

    return topLeadersForChart.reduce((acc, leader, index) => {
      const key = `series_${index}`;
      acc[key] = {
        label: leader.name,
        color: palette[index % palette.length],
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
                <ChartContainer config={chartConfig} className="h-56 w-full">
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="round" height={32} tickLine={false} axisLine={false} dy={12} tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} width={40} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {topLeadersForChart.map((leader, index) => {
                      const key = `series_${index}`;
                      return (
                        <Line
                          key={key}
                          type="monotone"
                          dataKey={key}
                          name={leader.name}
                          stroke={`var(--color-${key})`}
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          activeDot={{ r: 5 }}
                        />
                      );
                    })}
                  </LineChart>
                </ChartContainer>
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
