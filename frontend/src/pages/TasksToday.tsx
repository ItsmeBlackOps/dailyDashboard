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
import { toast } from "@/components/ui/use-toast";
import { useAuth, API_URL } from "@/hooks/useAuth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";
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

  const [reminders, setReminders] = useState<string[]>([]);
  const reminderTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const seenIds = useRef<Set<string>>(new Set());

  const { authFetch } = useAuth();

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
    socket.connect();

    socket.emit(
      "getTasksToday",
      (resp: { success: boolean; tasks?: Task[]; error?: string }) => {
        if (!resp.success) {
          setError(resp.error || "Failed to load tasks");
          return;
        }
        const initial = resp.tasks || [];
        setTasks(initial);
        initial.forEach((t) => seenIds.current.add(t._id));
      }
    );

    socket.on("taskCreated", (newTask: Task) => {
      if (!seenIds.current.has(newTask._id)) {
        seenIds.current.add(newTask._id);
        setTasks((prev) => [...prev, newTask]);
        const desc = newTask.subject || "";
        toast({ title: "New Task Added", description: desc });
        sendNotification("New Task Added", desc);
        playBeep();
      }
    });
    socket.on("taskUpdated", (updated: Task) => {
      setTasks((prev) =>
        prev.map((t) => (t._id === updated._id ? updated : t))
      );
    });

    return () => {
      socket.off("taskCreated");
      socket.off("taskUpdated");
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
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
      const candidate = DOMPurify.sanitize(task["Candidate Name"] || "candidate");
      console.log(
        `Scheduling reminder for ${candidate} at ${start.format()} in ${delay}ms`
      );
      const timer = setTimeout(() => {
        const msg = `Interview with ${candidate} starts at ${task["Start Time Of Interview"]}`;
        console.log(`Triggering reminder: ${msg}`);
        setReminders((r) => [...r, msg]);
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
  }, [tasks]);

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
      setMessage("Activity logged");
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  const statuses = Array.from(
    new Set(tasks.map((t) => t.status).filter(Boolean))
  );

  // **Always ascending by startTime → endTime**
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
        {reminders.map((r, i) => (
          <Alert
            key={i}
            className="border-blue-200 bg-blue-50 text-blue-900"
          >
            <Info className="h-4 w-4" />
            <AlertTitle>Reminder</AlertTitle>
            <AlertDescription>{r}</AlertDescription>
          </Alert>
        ))}

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
                      {DOMPurify.sanitize(task["End Time Of Interview"] || "")}
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
