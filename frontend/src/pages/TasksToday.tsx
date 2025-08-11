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

  // Preferred keys (if available)
  startTime?: string; // "MM/DD/YYYY HH:mm" or ISO
  endTime?: string;
  receivedDateTime?: string;

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
const PARSE_FMT = "MM/DD/YYYY HH:mm"; // 24h parsing for preferred keys
const LEGACY_FMT = "MM/DD/YYYY hh:mm A"; // legacy input format
const DATE_FMT = "MM/DD/YYYY";
const TIME_FMT = "hh:mm A";

// Reminder persistence keys
const REM_SCHEDULE_KEY = "interviewRemindersScheduled"; // JSON: { [key]: triggerAtISO }
const REM_FIRED_KEY = "interviewRemindersFired"; // JSON: string[]

// Reminder settings
const MINUTES_BEFORE = 35;
const MAX_DELAY = 2147483647; // ~24.85 days (2^31 - 1)

export default function TasksToday() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filterStatus, setFilterStatus] = useState("all");
  const [candidateFilter, setCandidateFilter] = useState("");
  const [recruiterFilter, setRecruiterFilter] = useState("");
  const [expertFilter, setExpertFilter] = useState("");
  const [dateScope, setDateScope] = useState<"today" | "all">("today");
  const [error, setError] = useState("");

  const firstLoad = useRef(true);

  // timersRef keeps active timeout ids per reminder key
  const timersRef = useRef<Map<string, number>>(new Map());
  const { refreshAccessToken } = useAuth();
  const user = localStorage.getItem("role");
  const { toast } = useToast();

  // Tab
  const selectedTab = localStorage.getItem("tab");
  const selectedTabRef = useRef(selectedTab);
  useEffect(() => {
    selectedTabRef.current = selectedTab;
  }, [selectedTab]);

  // === Storage helpers ===
  const readScheduled = (): Record<string, string> => {
    try {
      const raw = localStorage.getItem(REM_SCHEDULE_KEY) || "{}";
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      localStorage.setItem(REM_SCHEDULE_KEY, "{}");
      return {};
    }
  };

  const writeScheduled = (m: Record<string, string>) => {
    localStorage.setItem(REM_SCHEDULE_KEY, JSON.stringify(m));
  };

  const readFired = (): Set<string> => {
    try {
      const raw = localStorage.getItem(REM_FIRED_KEY) || "[]";
      const arr = JSON.parse(raw);
      return new Set<string>(Array.isArray(arr) ? arr : []);
    } catch {
      localStorage.setItem(REM_FIRED_KEY, "[]");
      return new Set<string>();
    }
  };

  const writeFired = (fired: Set<string>) => {
    localStorage.setItem(REM_FIRED_KEY, JSON.stringify([...fired]));
  };

  // === Socket ===
  const socket: Socket = useMemo(() => {
    const token = localStorage.getItem("accessToken") || "";
    return io(API_URL, {
      autoConnect: false,
      transports: ["websocket"],
      auth: { token },
    });
  }, []);

  // === Styling helpers ===
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

  // === Parsing helpers (strict) ===
  const parsePreferredStrict = (val?: string): Moment | null => {
    if (!val) return null;
    const m = moment(val, PARSE_FMT, true); // strict
    if (m.isValid()) return m.tz(TZ);
    const iso = moment(val, moment.ISO_8601, true);
    return iso.isValid() ? iso.tz(TZ) : null;
  };

  const parseLegacyStrict = (date?: string, time?: string): Moment | null => {
    if (!date || !time) return null;
    const base = moment(`${date} ${time}`, LEGACY_FMT, true); // strict
    return base.isValid() ? base.tz(TZ) : null;
  };

  const parseStart = (t: Task): Moment | null =>
    parsePreferredStrict(t.startTime) ||
    parseLegacyStrict(t["Date of Interview"], t["Start Time Of Interview"]);

  const parseEnd = (t: Task): Moment | null =>
    parsePreferredStrict(t.endTime) ||
    parseLegacyStrict(t["Date of Interview"], t["End Time Of Interview"]);

  const parseReceived = (t: Task): Moment | null =>
    parsePreferredStrict(t.receivedDateTime);

  // Which timestamp powers filters/sorting (depends on tab)
  const primaryStart = (t: Task): Moment | null => {
    const tab = selectedTabRef.current;
    if (tab === "receivedDateTime") return parseReceived(t);
    return parseStart(t);
  };

  const formatDate = (m: Moment | null) => (m ? m.tz(TZ).format(DATE_FMT) : "");
  const formatTime = (m: Moment | null) => (m ? m.tz(TZ).format(TIME_FMT) : "");

  // === Reminder key helpers ===
  const reminderKeyFor = (t: Task, start: Moment) => `${t._id}|${start.toISOString()}`;

  // === Schedule a long timeout by chaining if needed ===
  const ensureLargeTimeout = (key: string, ms: number, onFire: () => void) => {
    // If already scheduled, skip
    if (timersRef.current.has(key)) return;

    if (ms > MAX_DELAY) {
      const id = window.setTimeout(() => {
        timersRef.current.delete(key);
        ensureLargeTimeout(key, ms - MAX_DELAY, onFire);
      }, MAX_DELAY);
      timersRef.current.set(key, id);
      return;
    }

    const id = window.setTimeout(() => {
      timersRef.current.delete(key);
      onFire();
    }, Math.max(0, ms));
    timersRef.current.set(key, id);
  };

  // === Fire a reminder ===
  const fireReminder = (key: string, t: Task, firedSet: Set<string>) => {
    if (firedSet.has(key)) return; // already fired
    const subj = DOMPurify.sanitize(t.subject || "");
    toast({ title: "Interview Reminder", description: subj });
    sendNotification("Interview Reminder", subj);
    playTune();
    firedSet.add(key);
    writeFired(firedSet);

    // Remove from schedule store after firing
    const scheduled = readScheduled();
    delete scheduled[key];
    writeScheduled(scheduled);
  };

  // === Reconcile reminder schedules with tasks (persist + schedule timers) ===
  const reconcileReminders = useCallback(
    (incoming: Task[]) => {
      const now = moment.tz(TZ);
      const scheduled = readScheduled(); // key -> triggerAtISO
      const firedSet = readFired();

      // Build a set of valid keys from current tasks
      const validKeys = new Set<string>();

      for (const t of incoming) {
        const start = parseStart(t);
        if (!start || !start.isValid()) continue;

        const triggerAt = start.clone().subtract(MINUTES_BEFORE, "minutes");
        if (!triggerAt.isAfter(now)) continue; // skip past/too late

        const key = reminderKeyFor(t, start);
        validKeys.add(key);

        // If already fired, skip
        if (firedSet.has(key)) {
          // ensure it's not lingering in schedule store
          if (scheduled[key]) {
            delete scheduled[key];
          }
          continue;
        }

        // If not scheduled or trigger time changed, (re)schedule & persist
        const triggerISO = triggerAt.toISOString();
        if (scheduled[key] !== triggerISO) {
          // Update persistence
          scheduled[key] = triggerISO;

          // Clear any previous timer for this key
          const oldId = timersRef.current.get(key);
          if (oldId) {
            window.clearTimeout(oldId);
            timersRef.current.delete(key);
          }

          // Schedule new timer (with long-delay support)
          const delay = triggerAt.diff(now);
          ensureLargeTimeout(key, delay, () => fireReminder(key, t, firedSet));
        } else {
          // Already persisted; ensure a timer exists (reschedule on mount/reloads)
          if (!timersRef.current.has(key)) {
            const delay = triggerAt.diff(now);
            if (delay > 0) {
              ensureLargeTimeout(key, delay, () => fireReminder(key, t, firedSet));
            } else {
              // If it's already due but not fired, fire immediately and clean up
              fireReminder(key, t, firedSet);
            }
          }
        }
      }

      // Remove schedules for keys that are no longer valid (task removed or changed time)
      for (const schedKey of Object.keys(scheduled)) {
        if (!validKeys.has(schedKey)) {
          // cancel timer if exists
          const id = timersRef.current.get(schedKey);
          if (id) {
            window.clearTimeout(id);
            timersRef.current.delete(schedKey);
          }
          delete scheduled[schedKey];
        }
      }

      writeScheduled(scheduled);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // === Fetch & socket wiring ===
  const readMap = (): Record<string, string> =>
    JSON.parse(localStorage.getItem(TASK_STATUS_MAP) || "{}");
  const writeMap = (m: Record<string, string>) =>
    localStorage.setItem(TASK_STATUS_MAP, JSON.stringify(m));

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
          const aS = (primaryStart(a)?.toDate() ?? new Date(0)).getTime();
          const bS = (primaryStart(b)?.toDate() ?? new Date(0)).getTime();
          return aS - bS;
        });

        // Notifications for adds/updates
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

        // *** CRITICAL: persist & schedule reminders whenever tasks load ***
        reconcileReminders(incoming);
      }
    );
  }, [socket, toast, reconcileReminders]);

  useEffect(() => {
    const onNew = (task: Task) => {
      const isInit = firstLoad.current;
      const map = readMap();
      map[task._id] = task.status || "";
      writeMap(map);
      setTasks((prev) => {
        const next = [...prev, task];
        // reconcile with the updated list
        reconcileReminders(next);
        return next;
      });

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

      setTasks((list) => {
        const next = list.map((t) => (t._id === task._id ? task : t));
        reconcileReminders(next);
        return next;
      });
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

    socket.once("connect", fetchTasks);
    socket.connect();

    const interval = setInterval(fetchTasks, 60_000);

    return () => {
      socket.off("taskCreated", onNew);
      socket.off("taskUpdated", onUpdate);
      socket.off("connect_error", onAuthError);
      socket.disconnect();
      clearInterval(interval);

      // Clean all timers
      for (const [, id] of timersRef.current.entries()) window.clearTimeout(id);
      timersRef.current.clear();
    };
  }, [socket, toast, refreshAccessToken, fetchTasks, reconcileReminders]);

  // When tab changes, refetch & reconcile
  useEffect(() => {
    if (socket.connected) fetchTasks();
  }, [selectedTab, fetchTasks, socket]);

  // === Filtering / sorting ===
  const statuses = Array.from(new Set(tasks.map((t) => t.status).filter(Boolean)));

  const nowNY = moment.tz(TZ);
  const startOfTodayNY = nowNY.clone().startOf("day");
  const endOfTodayNY = nowNY.clone().endOf("day");

  const displayed = tasks
    .filter((t) => {
      const s = primaryStart(t);
      if (!s) return false;
      if (dateScope === "today") return s.isSame(startOfTodayNY, "day");
      return s.isAfter(endOfTodayNY);
    })
    .filter((t) => filterStatus === "all" || t.status === filterStatus)
    .filter((t) =>
      (t["Candidate Name"] || "").toLowerCase().includes(candidateFilter.toLowerCase())
    )
    .filter((t) =>
      (t.assignedExpert || "").toLowerCase().includes(expertFilter.toLowerCase())
    )
    .filter((t) =>
      user === "MAM" || user === "MM"
        ? (t.recruiterName || "").toLowerCase().includes(recruiterFilter.toLowerCase())
        : true
    )
    .sort((a, b) => {
      const aS = primaryStart(a)?.toDate() ?? new Date(0);
      const bS = primaryStart(b)?.toDate() ?? new Date(0);
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
          {selectedTab === "Date of Interview" && (
            <div className="flex rounded-md border border-border overflow-hidden">
              <Button
                variant="ghost"
                className={`rounded-none px-4 ${dateScope === "today" ? "bg-accent" : ""}`}
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
          )}

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
                {(user === "MAM" || user === "MM") && <TableHead>Recruiter</TableHead>}
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.map((task) => {
                const start = parseStart(task);
                const end = parseEnd(task);
                return (
                  <TableRow key={task._id} className={getRowBg(task.status)}>
                    <TableCell>{DOMPurify.sanitize(task.subject || "")}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task["Candidate Name"] || "")}</TableCell>
                    <TableCell>{formatDate(start)}</TableCell>
                    <TableCell>{formatTime(start)}</TableCell>
                    <TableCell>{formatTime(end)}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task["End Client"] || "")}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task["Interview Round"] || "")}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task.assignedExpert || "")}</TableCell>
                    {(user === "MAM" || user === "MM") && (
                      <TableCell>{DOMPurify.sanitize(task.recruiterName || "")}</TableCell>
                    )}
                    <TableCell>
                      {task.status && (
                        <Badge className={getStatusBadge(task.status)}>{task.status}</Badge>
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
