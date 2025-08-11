// src/components/TasksToday.tsx
import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import DOMPurify from "dompurify";
import moment, { Moment } from "moment-timezone";
import { io, Socket } from "socket.io-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useToast } from "@/hooks/use-toast";
import { useAuth, API_URL } from "@/hooks/useAuth";
import { playTune, sendNotification } from "@/utils/notify";
import { Toaster } from "@/components/ui/toaster";

interface Task {
  _id: string;
  subject?: string;

  // NEW preferred keys
  startTime?: string; // "MM/DD/YYYY HH:mm" or ISO
  endTime?: string;

  // Legacy keys (fallbacks)
  "Candidate Name"?: string;
  "Date of Interview"?: string;
  "Start Time Of Interview"?: string;
  "End Time Of Interview"?: string;
  "End Client"?: string;
  "Interview Round"?: string;

  status?: string;
  assignedEmail?: string;
  assignedExpert?: string;
  recruiterName?: string;
}

const TASK_STATUS_MAP = "tasksTodayStatusMap";
const TZ = "America/New_York";
const PARSE_FMT = "MM/DD/YYYY HH:mm"; // 24h parsing
const DATE_FMT = "MM/DD/YYYY";
const TIME_FMT = "hh:mm A";

export default function TasksToday() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filterStatus, setFilterStatus] = useState("all");
  const [candidateFilter, setCandidateFilter] = useState("");
  const [recruiterFilter, setRecruiterFilter] = useState("");
  const [expertFilter, setExpertFilter] = useState("");
  const [dateScope, setDateScope] = useState<"today" | "all">("today"); // "all" means AFTER today
  const [error, setError] = useState("");

  const firstLoad = useRef(true);
  const reminderTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { refreshAccessToken } = useAuth();
  const user = localStorage.getItem("role");
  const { toast } = useToast();

  // Persisted tab (set elsewhere)
  const selectedTab = localStorage.getItem("tab");
  const selectedTabRef = useRef(selectedTab);
  useEffect(() => {
    selectedTabRef.current = selectedTab;
  }, [selectedTab]);

  const readMap = (): Record<string, string> =>
    JSON.parse(localStorage.getItem(TASK_STATUS_MAP) || "{}");
  const writeMap = (m: Record<string, string>) =>
    localStorage.setItem(TASK_STATUS_MAP, JSON.stringify(m));

  // Socket.IO
  const socket: Socket = useMemo(() => {
    const token = localStorage.getItem("accessToken") || "";
    return io(API_URL, {
      autoConnect: false,
      transports: ["websocket"],
      auth: { token },
    });
  }, []);

  // Styling helpers
  const getStatusBadge = (status = "") =>
    ({
      completed: "bg-emerald-500 text-white",
      cancelled: "bg-red-500 text-white",
      acknowledged: "bg-amber-500 text-white",
      pending: "bg-blue-500 text-white",
    }[status.toLowerCase()] || "bg-gray-500 text-white");

  const getRowBg = (status = "") =>
    ({
      completed: "bg-emerald-500/10 border-emerald-500/30",
      cancelled: "bg-red-500/10 border-red-500/30",
      acknowledged: "bg-amber-500/10 border-amber-500/30",
      pending: "bg-blue-500/10 border-blue-500/30",
    }[status.toLowerCase()] || "bg-gray-500/10 border-gray-500/30");

  // --- Date/time helpers (new-first, legacy fallback) ---
  const parseStart = (t: Task): Moment | null => {
    if (t.startTime) {
      const m = moment.tz(t.startTime, PARSE_FMT, TZ);
      if (m.isValid()) return m;
      const iso = moment.tz(t.startTime, TZ);
      if (iso.isValid()) return iso;
    }
    if (t["Date of Interview"] && t["Start Time Of Interview"]) {
      const m = moment.tz(
        `${t["Date of Interview"]} ${t["Start Time Of Interview"]}`,
        "MM/DD/YYYY hh:mm A",
        TZ
      );
      return m.isValid() ? m : null;
    }
    return null;
  };

  const parseEnd = (t: Task): Moment | null => {
    if (t.endTime) {
      const m = moment.tz(t.endTime, PARSE_FMT, TZ);
      if (m.isValid()) return m;
      const iso = moment.tz(t.endTime, TZ);
      if (iso.isValid()) return iso;
    }
    if (t["Date of Interview"] && t["End Time Of Interview"]) {
      const m = moment.tz(
        `${t["Date of Interview"]} ${t["End Time Of Interview"]}`,
        "MM/DD/YYYY hh:mm A",
        TZ
      );
      return m.isValid() ? m : null;
    }
    return null;
  };

  const formatDate = (m: Moment | null) => (m ? m.tz(TZ).format(DATE_FMT) : "");
  const formatTime = (m: Moment | null) => (m ? m.tz(TZ).format(TIME_FMT) : "");

  // Load tasks
  const fetchTasks = useCallback(() => {
    socket.emit(
      "getTasksToday",
      { tab: selectedTabRef.current },
      (resp: { success: boolean; tasks?: Task[]; error?: string }) => {
        if (!resp.success) {
          setError(resp.error || "Failed to load tasks");
          toast({
            title: "Error",
            description: resp.error || "Failed to load tasks",
            variant: "destructive",
          });
          return;
        }

              const incoming = (resp.tasks || []).sort((a, b) => {
        // If startTime is a string like "2025-08-11T10:00:00"
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      });
        const oldMap = readMap();
        const newMap: Record<string, string> = {};

        incoming.forEach((task) => {
          newMap[task._id] = task.status || "";
          if (!firstLoad.current) {
            if (!(task._id in oldMap)) {
              const desc = DOMPurify.sanitize(task.subject || "");
              toast({ title: "New Task Added", description: desc });
              sendNotification("New Task Added", desc);
              playTune();
            } else if (oldMap[task._id] !== task.status) {
              const desc = DOMPurify.sanitize(task.subject || "");
              const s = DOMPurify.sanitize(task.status || "");
              toast({
                title: "Task Status Updated",
                description: `${desc} is now ${s}`,
              });
              sendNotification("Task Status Updated", `${desc} is now ${s}`);
              playTune();
            }
          }
        });

        writeMap(newMap);
        firstLoad.current = false;
        setTasks(incoming);
      }
    );
  }, [socket, toast]);

  useEffect(() => {
    const onNew = (task: Task) => {
      const isInit = firstLoad.current;
      const map = readMap();
      map[task._id] = task.status || "";
      writeMap(map);
      setTasks((prev) => [...prev, task]);

      if (!isInit) {
        const desc = DOMPurify.sanitize(task.subject || "");
        toast({ title: "New Task Added", description: desc });
        sendNotification("New Task Added", desc);
        playTune();
      }
    };

    const onUpdate = (task: Task) => {
      const map = readMap();
      const oldStatus = map[task._id] || "";
      if (oldStatus !== task.status) {
        const desc = DOMPurify.sanitize(task.subject || "");
        const statusDesc = DOMPurify.sanitize(task.status || "");
        toast({
          title: "Task Status Updated",
          description: `${desc} is now ${statusDesc}`,
        });
        sendNotification("Task Status Updated", `${desc} is now ${statusDesc}`);
        playTune();
      }
      map[task._id] = task.status || "";
      writeMap(map);
      setTasks((list) => list.map((t) => (t._id === task._id ? task : t)));
    };

    const onAuthError = async (err: Error) => {
      if (err.message !== "Unauthorized") return;
      const ok = await refreshAccessToken();
      if (!ok) return socket.disconnect();
      socket.auth = { token: localStorage.getItem("accessToken") || "" };
      socket.once("connect", fetchTasks);
      socket.connect();
    };

    socket.on("taskCreated", onNew);
    socket.on("taskUpdated", onUpdate);
    socket.on("connect_error", onAuthError);

    socket.once("connect", () => {
      fetchTasks();
    });
    socket.connect();

    const interval = setInterval(fetchTasks, 60_000);
    return () => {
      socket.off("taskCreated", onNew);
      socket.off("taskUpdated", onUpdate);
      socket.off("connect_error", onAuthError);
      socket.disconnect();
      clearInterval(interval);
    };
  }, [socket, toast, refreshAccessToken, fetchTasks]);

  useEffect(() => {
    if (socket.connected) {
      fetchTasks();
    }
  }, [selectedTab, fetchTasks, socket]);

  // 35-minute reminders based on startTime
  useEffect(() => {
    reminderTimers.current.forEach(clearTimeout);
    reminderTimers.current = [];

    const now = moment.tz(TZ);

    tasks.forEach((t) => {
      const start = parseStart(t);
      if (!start || !start.isValid()) return;

      const reminderAt = start.clone().subtract(35, "minutes");
      const delay = reminderAt.diff(now);

      if (delay <= 0) return;

      const timer = setTimeout(() => {
        const subj = DOMPurify.sanitize(t.subject || "");
        toast({ title: "Interview Reminder", description: subj });
        sendNotification("Interview Reminder", subj);
        playTune();
      }, delay);

      reminderTimers.current.push(timer);
    });

    return () => {
      reminderTimers.current.forEach(clearTimeout);
      reminderTimers.current = [];
    };
  }, [tasks, toast]);

  // Distinct statuses for filter
  const statuses = Array.from(
    new Set(tasks.map((t) => t.status).filter(Boolean))
  );

  // === Date scope logic ===
  // "today" -> tasks whose startTime is on today's date (NY)
  // "all"   -> tasks strictly AFTER today (i.e., start > endOfTodayNY)
  const nowNY = moment.tz(TZ);
  const startOfTodayNY = nowNY.clone().startOf("day");
  const endOfTodayNY = nowNY.clone().endOf("day");

  const displayed = tasks
    .filter((t) => {
      const s = parseStart(t);
      if (!s) return false;

      if (dateScope === "today") {
        // same calendar day in TZ
        return s.isSame(startOfTodayNY, "day");
      }

      // "all" = strictly after today
      return s.isAfter(endOfTodayNY);
    })
    .filter((t) => filterStatus === "all" || t.status === filterStatus)
    .filter((t) =>
      (t["Candidate Name"] || "")
        .toLowerCase()
        .includes(candidateFilter.toLowerCase())
    )
    .filter((t) =>
      (t.assignedExpert || "")
        .toLowerCase()
        .includes(expertFilter.toLowerCase())
    )
    .filter((t) =>
      user === "MAM" || user === "MM"
        ? (t.recruiterName || "")
            .toLowerCase()
            .includes(recruiterFilter.toLowerCase())
        : true
    )
    .sort((a, b) => {
      const aS = parseStart(a)?.toDate() ?? new Date(0);
      const bS = parseStart(b)?.toDate() ?? new Date(0);
      if (aS.getTime() !== bS.getTime()) return aS < bS ? -1 : 1;

      const aE = parseEnd(a)?.toDate() ?? new Date(0);
      const bE = parseEnd(b)?.toDate() ?? new Date(0);
      return aE < bE ? -1 : aE > bE ? 1 : 0;
    });

  return (
    <DashboardLayout>
      <Toaster />
      <div className="p-4 space-y-4">
        <h2 className="text-xl font-semibold">Today's Tasks</h2>
        {error && <p className="text-red-500">{error}</p>}

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-center">
          {/* Today / All (All = After Today) */}
          <div className="flex rounded-md border border-border overflow-hidden">
            <Button
              variant="ghost"
              className={`rounded-none px-4 ${
                dateScope === "today" ? "bg-accent" : ""
              }`}
              onClick={() => setDateScope("today")}
            >
              Today
            </Button>
            <Button
              variant="ghost"
              className={`rounded-none px-4 border-l border-border ${
                dateScope === "all" ? "bg-accent" : ""
              }`}
              onClick={() => setDateScope("all")}
              title="All = after today"
            >
              All
            </Button>
          </div>

          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s!}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder="Filter candidate"
            value={candidateFilter}
            onChange={(e) => setCandidateFilter(e.target.value)}
            className="w-40"
          />
          <Input
            placeholder="Filter expert"
            value={expertFilter}
            onChange={(e) => setExpertFilter(e.target.value)}
            className="w-40"
          />
          {(user === "MAM" || user === "MM") && (
            <Input
              placeholder="Filter recruiter"
              value={recruiterFilter}
              onChange={(e) => setRecruiterFilter(e.target.value)}
              className="w-40"
            />
          )}
        </div>

        {displayed.length === 0 ? (
          <p>No tasks found</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Candidate</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Round</TableHead>
                <TableHead>Expert</TableHead>
                {(user === "MAM" || user === "MM") && (
                  <TableHead>Recruiter</TableHead>
                )}
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.map((task) => {
                const start = parseStart(task);
                const end = parseEnd(task);
                return (
                  <TableRow key={task._id} className={getRowBg(task.status)}>
                    <TableCell>
                      {DOMPurify.sanitize(task.subject || "")}
                    </TableCell>
                    <TableCell>
                      {DOMPurify.sanitize(task["Candidate Name"] || "")} </TableCell>
                   <TableCell>{DOMPurify.sanitize(task["Date of Interview"] || "")}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task["Start Time Of Interview"] || "")}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task["End Time Of Interview"] || "")}</TableCell>
                    
                    <TableCell>
                      {DOMPurify.sanitize(task["End Client"] || "")}
                    </TableCell>
                    <TableCell>
                      {DOMPurify.sanitize(task["Interview Round"] || "")}
                    </TableCell>
                    <TableCell>
                      {DOMPurify.sanitize(task.assignedExpert || "")}
                    </TableCell>
                    {(user === "MAM" || user === "MM") && (
                      <TableCell>
                        {DOMPurify.sanitize(task.recruiterName || "")}
                      </TableCell>
                    )}
                    <TableCell>
                      {task.status && (
                        <Badge className={getStatusBadge(task.status)}>
                          {task.status}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </DashboardLayout>
  );
}
