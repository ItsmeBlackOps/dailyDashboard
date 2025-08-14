// src/components/TopAgents.tsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth, API_URL } from "@/hooks/useAuth";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type SummaryRow = {
  ["Candidate Name"]: string;
  statusCount: Record<string, number>;
  ["Last Sender"]?: string;
  ["Last CC"]?: string;
  Expert?: string; // assignedTo
};

interface Agent {
  id: string;
  name: string;
  image?: string;
  initials: string;
  counts: Record<string, number>;
}

const START_ISO = "2025-08-01T00:00:00Z";
const END_ISO   = "2025-09-01T00:00:00Z";

type ViewMode = "expert" | "recruiter" | "candidate";

// Helpers
function humanizeName(input?: string): string {
  if (!input) return "Unknown";
  let s = String(input).trim();
  if (s.includes("@")) s = s.split("@")[0];
  const parts = s.split(/[._\s-]+/).filter(Boolean);
  if (parts.length === 0) return "Unknown";
  return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
}
function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function normalizeKey(k: string): string {
  return (k || "").trim();
}
function badgeClassFor(key: string): string {
  const s = key.trim().toLowerCase();
  if (s === "completed")    return "bg-emerald-600 text-white";
  if (s === "cancelled")    return "bg-red-600 text-white";
  if (s === "acknowledged") return "bg-amber-600 text-white";
  if (s === "pending")      return "bg-blue-600 text-white";
  return "bg-gray-600 text-white";
}

export function TopAgents() {
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  const { refreshAccessToken } = useAuth();
  const role = useMemo(() => (localStorage.getItem("role") || "").trim(), []);

  // Allowed views by role
  const allowedViews: ViewMode[] = useMemo(() => {
    if (role === "admin") return ["expert", "recruiter", "candidate"];
    if (role === "MM" || role === "MAM" || role === "mlead") return ["recruiter", "candidate"];
    if (role === "lead") return ["expert", "candidate"];
    return ["candidate"];
  }, [role]);

  const [view, setView] = useState<ViewMode>(allowedViews[0]);

  // Re-align selected view if role changes or restrictions apply
  useEffect(() => {
    if (!allowedViews.includes(view)) setView(allowedViews[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedViews.join("|")]);

  // Socket
  const socket: Socket = useMemo(() => {
    const token = localStorage.getItem("accessToken") || "";
    return io(API_URL, {
      autoConnect: false,
      transports: ["websocket"],
      auth: { token },
    });
  }, []);

  // Data fetch
  const fetchSummary = useCallback(() => {
    setLoading(true);
    setError("");
    socket.emit(
      "getDashboardSummary",
      { start: START_ISO, end: END_ISO },
      (resp: { success: boolean; summary?: SummaryRow[]; error?: string }) => {
        console.log("[TopAgents] getDashboardSummary ->", resp);
        if (!resp || !resp.success || !resp.summary) {
          setError(resp?.error || "Failed to load agents");
          setRows([]);
          setAgents([]);
          setLoading(false);
          return;
        }
        setRows(resp.summary);
        setLoading(false);
      }
    );
  }, [socket]);

  // Transform rows -> agents for the selected view
  const buildAgents = useCallback((data: SummaryRow[], mode: ViewMode): Agent[] => {
    const map = new Map<string, Agent>();

    for (const row of data) {
      let rawName = "Unknown";
      if (mode === "expert") {
        rawName = row.Expert ?? "Unknown";
      } else if (mode === "recruiter") {
        rawName = row["Last Sender"] ?? "Unknown";
      } else { // candidate
        rawName = (row["Candidate Name"] ?? "Unknown").trim();
      }

      const displayName = mode === "candidate" ? rawName : humanizeName(rawName);
      const key = displayName.toLowerCase();

      const normalized: Record<string, number> = {};
      for (const [k, v] of Object.entries(row.statusCount || {})) {
        const nk = normalizeKey(k);
        const val = typeof v === "number" ? v : 0;
        normalized[nk] = (normalized[nk] || 0) + val;
      }

      if (!map.has(key)) {
        map.set(key, {
          id: key,
          name: displayName,
          initials: initialsFrom(displayName),
          image: undefined,
          counts: normalized,
        });
      } else {
        const prev = map.get(key)!;
        const merged: Record<string, number> = { ...prev.counts };
        for (const [k, v] of Object.entries(normalized)) {
          merged[k] = (merged[k] || 0) + (v || 0);
        }
        map.set(key, { ...prev, counts: merged });
      }
    }

    // Sort by completed desc, then total desc, then name
    return Array.from(map.values()).sort((a, b) => {
      const ac = a.counts["completed"] ?? a.counts["Completed"] ?? 0;
      const bc = b.counts["completed"] ?? b.counts["Completed"] ?? 0;
      if (bc !== ac) return bc - ac;
      const at = Object.values(a.counts).reduce((x, y) => x + y, 0);
      const bt = Object.values(b.counts).reduce((x, y) => x + y, 0);
      if (bt !== at) return bt - at;
      return a.name.localeCompare(b.name);
    });
  }, []);

  // Rebuild agents whenever rows or view change
  useEffect(() => {
    setAgents(buildAgents(rows, view));
  }, [rows, view, buildAgents]);

  // Socket lifecycle
  useEffect(() => {
    const onConnect = () => {
      console.log("[TopAgents] socket connected:", socket.id);
      fetchSummary();
    };
    const onDisconnect = (reason: string) => {
      console.log("[TopAgents] socket disconnected:", reason);
    };
    const onAuthError = async (err: Error) => {
      if (err.message !== "Unauthorized") return;
      console.warn("[TopAgents] Unauthorized — trying refreshAccessToken()");
      const ok = await refreshAccessToken();
      if (!ok) {
        console.error("[TopAgents] Token refresh failed — cannot fetch summary");
        return;
      }
      socket.auth = { token: localStorage.getItem("accessToken") || "" };
      socket.once("connect", fetchSummary);
      socket.connect();
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onAuthError);

    socket.connect();
    const interval = setInterval(fetchSummary, 60_000);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onAuthError);
      socket.disconnect();
      clearInterval(interval);
    };
  }, [socket, fetchSummary, refreshAccessToken]);

  // Row highlight classes per your rule & new red style
  const rowHighlightClasses = useCallback((a: Agent) => {
    const completed = a.counts["completed"] ?? a.counts["Completed"] ?? 0;

    if (role === "MM" || role === "MAM" || role === "mlead") {
      return completed < 5
        ? "bg-red-500/10 border-red-500/30"
        : "border-border";
    }
    if (role === "lead" || role === "admin" || role === "user") {
      return completed >= 5
        ? "bg-red-500/10 border-red-500/30"
        : "border-border";
    }
    return "border-border";
  }, [role]);

  // View selector label map
  const viewLabel: Record<ViewMode, string> = {
    expert: "Expert Wise",
    recruiter: "Recruiter Wise",
    candidate: "Candidate Wise",
  };

  return (
    <Card className="dashboard-card">
      <CardHeader className="mb-1 p-0 flex items-center justify-between">
        <CardTitle className="text-lg font-medium">Top Performing Agents</CardTitle>

        {/* Show selector only if multiple views are allowed */}
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
          // If only one view, keep layout stable with a subtle label
          <div className="text-xs text-muted-foreground">{viewLabel[allowedViews[0]]}</div>
        )}
      </CardHeader>

      <CardContent className="px-0 pt-2">
        {loading ? (
          <p className="text-sm text-muted-foreground px-1">Loading…</p>
        ) : error ? (
          <p className="text-sm text-destructive px-1">{error}</p>
        ) : agents.length === 0 ? (
          <p className="text-sm text-muted-foreground px-1">
            No data for Aug 1–31, 2025.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto pr-2 space-y-3">
            {agents.map((agent) => {
              const entries = Object.entries(agent.counts)
                .filter(([, v]) => (v ?? 0) > 0)
                .sort((a, b) => {
                  const diff = (b[1] ?? 0) - (a[1] ?? 0);
                  return diff !== 0 ? diff : a[0].localeCompare(b[0]);
                });

              return (
                <div
                  key={agent.id}
                  className={[
                    "flex items-center gap-4 rounded-xl p-2 border",
                    rowHighlightClasses(agent),
                  ].join(" ")}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={agent.image} alt={agent.name} />
                    <AvatarFallback>{initialsFrom(agent.name)}</AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-1">
                      <p className="text-sm font-medium truncate">{agent.name}</p>
                    </div>

                    {/* Dynamic round/status chips */}
                    <div className="flex flex-wrap gap-2">
                      {entries.map(([label, count]) => (
                        <Badge
                          key={label}
                          className={`${badgeClassFor(label)} text-xs`}
                        >
                          {label}: {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
