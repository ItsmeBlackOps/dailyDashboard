import { useEffect, useState, useRef, useMemo } from "react";
import DOMPurify from "dompurify";
import moment from "moment-timezone";
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
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth, API_URL } from "@/hooks/useAuth";
import { playBeep, sendNotification } from "@/utils/notify";

interface Task {
  _id: string;
  subject?: string;
  "Candidate Name"?: string;
  "Date of Interview"?: string;
  "Start Time Of Interview"?: string;
  "End Time Of Interview"?: string;
  "End Client"?: string;
  "Interview Round"?: string;
  status?: string;
  assignedEmail?: string;
  assignedExpert?: string;
  startTime?: Date;
  endTime?: Date;
}

export default function TasksToday() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState("");
  const [message, setMessage] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [candidateFilter, setCandidateFilter] = useState("");
  const [expertFilter, setExpertFilter] = useState("");

  const seenIds = useRef<Set<string>>(new Set());
  const reminderTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { authFetch, refreshAccessToken } = useAuth();
  const { toast } = useToast();

  const socket: Socket = useMemo(() => {
    const token = localStorage.getItem("accessToken") || "";
    return io(API_URL, {
      autoConnect: false,
      transports: ["websocket"],
      auth: { token },
    });
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case "completed":
        return "bg-emerald-500 text-white";
      case "cancelled":
        return "bg-red-500 text-white";
      case "acknowledged":
        return "bg-amber-500 text-white";
      case "pending":
        return "bg-blue-500 text-white";
      default:
        return "bg-gray-500 text-white";
    }
  };
  const getRowBg = (status: string) => {
    switch (status?.toLowerCase()) {
      case "completed":
        return "bg-emerald-500/10 border-emerald-500/30";
      case "cancelled":
        return "bg-red-500/10 border-red-500/30";
      case "acknowledged":
        return "bg-amber-500/10 border-amber-500/30";
      case "pending":
        return "bg-blue-500/10 border-blue-500/30";
      default:
        return "bg-gray-500/10 border-gray-500/30";
    }
  };

  useEffect(() => {
    // Handlers
    const handleNew = (newTask: Task) => {
      if (seenIds.current.has(newTask._id)) return;
      seenIds.current.add(newTask._id);
      setTasks((prev) => [...prev, newTask]);
      const desc = DOMPurify.sanitize(newTask.subject || "");
      toast({ title: "New Task Added", description: desc });
      sendNotification("New Task Added", desc);
      playBeep();
    };

    const handleUpdate = (updated: Task) => {
      setTasks((prev) =>
        prev.map((t) => (t._id === updated._id ? updated : t))
      );
    };

    const handleConnectError = async (err: Error) => {
      if (err.message !== "Unauthorized") return;
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        socket.disconnect();
        return;
      }
      const newToken = localStorage.getItem("accessToken") || "";
      socket.auth = { token: newToken };
      socket.once("connect", fetchTasks);
      socket.connect();
    };

    // Register listeners before connect
    socket.on("taskCreated", handleNew);
    socket.on("taskUpdated", handleUpdate);
    socket.on("connect_error", handleConnectError);

    const fetchTasks = () => {
      socket.emit(
        "getTasksToday",
        (resp: { success: boolean; tasks?: Task[]; error?: string }) => {
          if (!resp.success) {
            const msg = resp.error || "Failed to load tasks";
            setError(msg);
            toast({ title: "Error", description: msg, variant: "destructive" });
            return;
          }
          const received = resp.tasks || [];
          setTasks((prev) => {
            const map = new Map(prev.map((t) => [t._id, t]));
            const updated = [...prev];
            for (const task of received) {
              const existing = map.get(task._id);
              if (!existing) {
                updated.push(task);
                seenIds.current.add(task._id);
                const desc = DOMPurify.sanitize(task.subject || "");
                toast({ title: "New Task Added", description: desc });
                sendNotification("New Task Added", desc);
                playBeep();
              } else {
                Object.assign(existing, task);
              }
            }
            return updated;
          });
        }
      );
    };

    socket.once("connect", fetchTasks);
    socket.connect();
    const interval = setInterval(fetchTasks, 60_000);

    return () => {
      socket.off("taskCreated", handleNew);
      socket.off("taskUpdated", handleUpdate);
      socket.off("connect_error", handleConnectError);
      socket.disconnect();
      clearInterval(interval);
    };
  }, [socket, toast]);

  useEffect(() => {
    // clear timers
    reminderTimers.current.forEach(clearTimeout);
    reminderTimers.current = [];

    const parseDT = (
      task: Task,
      key: "Start Time Of Interview" | "End Time Of Interview"
    ) =>
      moment.tz(
        `${task["Date of Interview"]} ${task[key]}`,
        "MM/DD/YYYY hh:mm A",
        "America/New_York"
      );

    const now = moment.tz("America/New_York");

    tasks.forEach((task) => {
      const start = parseDT(task, "Start Time Of Interview");
      if (!start.isValid()) return;
      const reminderTime = start.clone().subtract(35, "minutes");
      const delay = reminderTime.diff(now);
      if (delay <= 0) return;

      const candidate = DOMPurify.sanitize(
        task["Candidate Name"] || "candidate"
      );
      const timer = setTimeout(() => {
        const startTime = DOMPurify.sanitize(
          task["Start Time Of Interview"] || ""
        );
        const msg = `Interview with ${candidate} starts at ${startTime}`;
        toast({ title: "Interview Reminder", description: msg });
        sendNotification("Interview Reminder", msg);
        playBeep();
      }, delay);

      reminderTimers.current.push(timer);
    });

    return () => {
      reminderTimers.current.forEach(clearTimeout);
      reminderTimers.current = [];
    };
  }, [tasks, toast]);

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    try {
      const token = localStorage.getItem("accessToken") || "";
      const { email } = JSON.parse(atob(token.split(".")[1]));
      const role = localStorage.getItem("role") || "";
      const teamLead = localStorage.getItem("teamLead") || "";
      const manager = localStorage.getItem("manager") || "";
      const res = await authFetch(`${API_URL}tasks/today`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role, teamLead, manager, activity }),
      });
      if (!res.ok) throw new Error("Failed to post activity");
      setActivity("");
      const msg = "Activity logged";
      setMessage(msg);
      toast({ title: "Success", description: msg });
    } catch (err) {
      const msg = (err as Error).message;
      setMessage(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    }
  };

  const statuses = Array.from(
    new Set(tasks.map((t) => t.status).filter(Boolean))
  );

  const displayedTasks = tasks
    .filter((t) => filterStatus === "all" || t.status === filterStatus)
    .filter((t) =>
      t["Candidate Name"]?.toLowerCase().includes(candidateFilter.toLowerCase())
    )
    .filter((t) =>
      t.assignedExpert?.toLowerCase().includes(expertFilter.toLowerCase())
    )
    .sort((a, b) => {
      const parseDT = (
        task: Task,
        key: "Start Time Of Interview" | "End Time Of Interview"
      ) =>
        moment(
          `${task["Date of Interview"]} ${task[key]}`,
          "MM/DD/YYYY hh:mm A"
        ).toDate();

      const aStart = parseDT(a, "Start Time Of Interview");
      const bStart = parseDT(b, "Start Time Of Interview");
      if (aStart < bStart) return -1;
      if (aStart > bStart) return 1;

      const aEnd = parseDT(a, "End Time Of Interview");
      const bEnd = parseDT(b, "End Time Of Interview");
      if (aEnd < bEnd) return -1;
      if (aEnd > bEnd) return 1;

      return 0;
    });

  return (
    <DashboardLayout>
      <div className="p-4 space-y-4">
        <h2 className="text-xl font-semibold">Today's Tasks</h2>
        {error && <p className="text-red-500 mb-2">{error}</p>}

        {displayedTasks.length === 0 ? (
          <p>No tasks found</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-4 items-center">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {statuses.map((s) => (
                    <SelectItem key={s} value={s}>
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
            </div>

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
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedTasks.map((task) => (
                  <TableRow
                    key={task._id}
                    className={getRowBg(task.status || "")}
                  >
                    <TableCell>
                      {DOMPurify.sanitize(task.subject || "")}
                    </TableCell>
                    <TableCell>
                      {DOMPurify.sanitize(task["Candidate Name"] || "")}
                    </TableCell>
                    <TableCell>
                      {DOMPurify.sanitize(task["Date of Interview"] || "")}
                    </TableCell>
                    <TableCell>
                      {DOMPurify.sanitize(
                        task["Start Time Of Interview"] || ""
                      )}
                    </TableCell>
                    <TableCell>
                      {DOMPurify.sanitize(
                        task["End Time Of Interview"] || ""
                      )}
                    </TableCell>
                    <TableCell>
                      {DOMPurify.sanitize(task["End Client"] || "")}
                    </TableCell>
                    <TableCell>
                      {DOMPurify.sanitize(task["Interview Round"] || "")}
                    </TableCell>
                    <TableCell>
                      {DOMPurify.sanitize(task.assignedExpert || "")}
                    </TableCell>
                    <TableCell>
                      {task.status && (
                        <Badge className={getStatusBadge(task.status)}>
                          {task.status}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
