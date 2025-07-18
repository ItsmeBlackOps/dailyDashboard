// src/components/TasksToday.tsx
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
import { useToast } from "@/hooks/use-toast";
import { useAuth, API_URL } from "@/hooks/useAuth";
import { playTune, sendNotification } from "@/utils/notify";
import { Toaster } from "@/components/ui/toaster";

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
}

const TASK_STATUS_MAP = "tasksTodayStatusMap";

export default function TasksToday() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filterStatus, setFilterStatus] = useState("all");
  const [candidateFilter, setCandidateFilter] = useState("");
  const [expertFilter, setExpertFilter] = useState("");
  const [error, setError] = useState("");

  const firstLoad = useRef(true);
  const reminderTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { refreshAccessToken } = useAuth();
  const { toast } = useToast();

  // Initialize Socket.IO
  const socket: Socket = useMemo(() => {
    const token = localStorage.getItem("accessToken") || "";
    return io(API_URL, {
      autoConnect: false,
      transports: ["websocket"],
      auth: { token },
    });
  }, []);

  // Helpers for styling
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

  useEffect(() => {
    const readMap = (): Record<string, string> =>
      JSON.parse(localStorage.getItem(TASK_STATUS_MAP) || "{}");
    const writeMap = (m: Record<string, string>) =>
      localStorage.setItem(TASK_STATUS_MAP, JSON.stringify(m));

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
        console.log(`[tune] new task: id=${task._id}, subject="${task.subject}"`);
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
        console.log(
          `[tune] status change: id=${task._id}, "${oldStatus}" → "${task.status}"`
        );
        playTune();
      }
      map[task._id] = task.status || "";
      writeMap(map);

      setTasks((list) => list.map((t) => (t._id === task._id ? task : t)));
    };

    const onAuthError = async (err: Error) => {
      if (err.message !== "Unauthorized") return;
      console.log("[socket] unauthorized – refreshing token");
      const ok = await refreshAccessToken();
      if (!ok) return socket.disconnect();
      socket.auth = { token: localStorage.getItem("accessToken") || "" };
      socket.once("connect", fetchTasks);
      socket.connect();
    };

    const fetchTasks = () => {
      
      socket.emit(
        "getTasksToday",
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

          const incoming = resp.tasks || [];
          const oldMap = readMap();
          const newMap: Record<string, string> = {};
          incoming.forEach((task) => {
            newMap[task._id] = task.status || "";
            if (!firstLoad.current) {
              if (!(task._id in oldMap)) {
                const desc = DOMPurify.sanitize(task.subject || "");
                toast({ title: "New Task Added", description: desc });
                sendNotification("New Task Added", desc);
                console.log(
                  `[tune] poll-new: id=${task._id}, subject="${task.subject}"`
                );
                playTune();
              } else if (oldMap[task._id] !== task.status) {
                const desc = DOMPurify.sanitize(task.subject || "");
                const s = DOMPurify.sanitize(task.status || "");
                toast({
                  title: "Task Status Updated",
                  description: `${desc} is now ${s}`,
                });
                sendNotification("Task Status Updated", `${desc} is now ${s}`);
                console.log(
                  `[tune] poll-status: id=${task._id}, "${oldMap[task._id]}" → "${task.status}"`
                );
                playTune();
              }
            }
          });

          writeMap(newMap);
          firstLoad.current = false;
          setTasks(incoming);
        }
      );
    };

    socket.on("taskCreated", onNew);
    socket.on("taskUpdated", onUpdate);
    socket.on("connect_error", onAuthError);

    socket.once("connect", () => {
      console.log("[socket] connected");
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
  }, [socket, toast, refreshAccessToken]);

  // 35-minute reminder exactly at T–35m
  useEffect(() => {
    reminderTimers.current.forEach(clearTimeout);
    reminderTimers.current = [];

    const parseDT = (
      t: Task,
      key: "Start Time Of Interview" | "End Time Of Interview"
    ) =>
      moment.tz(
        `${t["Date of Interview"]} ${t[key]}`,
        "MM/DD/YYYY hh:mm A",
        "America/New_York"
      );
    const now = moment.tz("America/New_York");

    tasks.forEach((t) => {
      const start = parseDT(t, "Start Time Of Interview");
      if (!start.isValid()) return;

      const reminderAt = start.clone().subtract(35, "minutes");
      const delay = reminderAt.diff(now);

      if (delay <= 0) {
        console.log(
          `[reminder] skipping ${t._id}: less than 35m to start or passed`
        );
        return;
      }

      console.log(
        `[reminder] scheduling ${t._id} at ${reminderAt.format()} (in ${delay}ms)`
      );

      const timer = setTimeout(() => {
        const subj = DOMPurify.sanitize(t.subject || "");
        toast({ title: "Interview Reminder", description: subj });
        sendNotification("Interview Reminder", subj);
        console.log(
          `[tune] reminder for ${t._id} fired at ${moment
            .tz("America/New_York")
            .format()} — 35m before start`
        );
        playTune();
      }, delay);

      reminderTimers.current.push(timer);
    });

    return () => {
      reminderTimers.current.forEach(clearTimeout);
      reminderTimers.current = [];
    };
  }, [tasks, toast]);

  // Filter & sort for rendering
  const statuses = Array.from(
    new Set(tasks.map((t) => t.status).filter(Boolean))
  );
  const displayed = tasks
    .filter((t) => filterStatus === "all" || t.status === filterStatus)
    .filter((t) =>
      t["Candidate Name"]
        ?.toLowerCase()
        .includes(candidateFilter.toLowerCase())
    )
    .filter((t) =>
      t.assignedExpert?.toLowerCase().includes(expertFilter.toLowerCase())
    )
    .sort((a, b) => {
      const toDate = (x: Task, k: keyof Task) =>
        moment(
          `${x["Date of Interview"]} ${x[k]}`,
          "MM/DD/YYYY hh:mm A"
        ).toDate();
      const aS = toDate(a, "Start Time Of Interview"),
        bS = toDate(b, "Start Time Of Interview");
      if (aS !== bS) return aS < bS ? -1 : 1;
      const aE = toDate(a, "End Time Of Interview"),
        bE = toDate(b, "End Time Of Interview");
      return aE < bE ? -1 : aE > bE ? 1 : 0;
    });

  return (
    <DashboardLayout>
      <Toaster />
      <div className="p-4 space-y-4">
        <h2 className="text-xl font-semibold">Today's Tasks</h2>
        {error && <p className="text-red-500">{error}</p>}
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
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map((task) => (
                  <TableRow
                    key={task._id}
                    className={getRowBg(task.status)}
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
