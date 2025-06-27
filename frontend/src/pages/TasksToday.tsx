import { useEffect, useState, useRef } from 'react';
import DOMPurify from 'dompurify';
import moment from 'moment-timezone';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';

function getEmailFromToken() {
  try {
    const token = localStorage.getItem('accessToken');
    if (!token) return '';
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.email || '';
  } catch {
    return '';
  }
}

interface Task {
  _id: string;
  subject?: string;
  'Candidate Name'?: string;
  'Date of Interview'?: string;
  'Start Time Of Interview'?: string;
  'End Time Of Interview'?: string;
  'End Client'?: string;
  'Interview Round'?: string;
  status?: string;
  assignedEmail?: string;
}

export default function TasksToday() {
  const { authFetch } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState('');
  const [message, setMessage] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortAsc, setSortAsc] = useState(true);

  // keep track of IDs we’ve already seen
  const seenIds = useRef<Set<string>>(new Set());

  function playBeep() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 440;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 1);
    } catch {
      // ignore
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      case 'in-progress':
        return 'bg-yellow-100 text-yellow-800';
      case 'pending':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getRowBg = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
        return 'bg-green-50';
      case 'cancelled':
        return 'bg-red-50';
      case 'in-progress':
        return 'bg-yellow-50';
      case 'pending':
        return 'bg-blue-50';
      default:
        return '';
    }
  };

  // --- load tasks once on mount ---
  const loadTasks = async () => {
    try {
      const res = await authFetch('https://dailydb.tunn.dev/tasks/today');
      if (!res.ok) throw new Error('Failed to load tasks');
      const data: Task[] = await res.json();
      setTasks(data);
      // mark these as seen
      data.forEach(t => seenIds.current.add(t._id));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  useEffect(() => {
    loadTasks();
  }, [authFetch]);

  // --- poll once a minute for new tasks ---
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await authFetch('http://localhost:3000/tasks/today');
        if (!res.ok) return;
        const data: Task[] = await res.json();
        // find new ones
        const newTasks = data.filter(t => !seenIds.current.has(t._id));
        if (newTasks.length > 0) {
          newTasks.forEach(t => {
            const subj = t.subject ?? 'New task';
            toast({ title: 'New Task Added', description: subj });
            playBeep();
            seenIds.current.add(t._id);
          });
          // update main list so your 35-min reminders include them too
          setTasks(data);
        }
      } catch {
        // swallow errors
      }
    }, 60 * 1000);

    return () => clearInterval(id);
  }, [authFetch]);

  // --- schedule 35-minute-prior reminders ---
  useEffect(() => {
    if (tasks.length === 0) return;

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const timers: Array<ReturnType<typeof setTimeout>> = [];

    tasks.forEach((task) => {
      const dateStr = task['Date of Interview'];
      const timeStr = task['Start Time Of Interview'];
      if (!dateStr || !timeStr) return;

      const start = moment.tz(
        `${dateStr} ${timeStr}`,
        'MM/DD/YYYY HH:mm',
        moment.tz.guess()
      );
      if (!start.isValid()) return;

      const reminderTime = start.clone().subtract(35, 'minutes');
      const delay = reminderTime.diff(moment());
      if (delay <= 0) return; // too late

      const timer = setTimeout(() => {
        const candidate = task['Candidate Name'] ?? 'candidate';
        const msg = `Interview with ${candidate} starts at ${timeStr}`;
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Interview Reminder', { body: msg });
        }
        toast({ title: 'Interview Reminder', description: msg });
        playBeep();
      }, delay);

      timers.push(timer);
    });

    return () => timers.forEach(clearTimeout);
  }, [tasks]);

  // --- optional: manual refresh form for logging activity ---
  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    try {
      const email = getEmailFromToken();
      const role = localStorage.getItem('role') || '';
      const teamLead = localStorage.getItem('teamLead') || '';
      const manager = localStorage.getItem('manager') || '';
      const res = await authFetch('http://localhost:3000/tasks/today', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role, teamLead, manager, activity }),
      });
      if (!res.ok) throw new Error('Failed to post activity');
      setActivity('');
      setMessage('Activity logged');
    } catch (err) {
      setMessage((err as Error).message);
    }
  };

  const statuses = Array.from(new Set(tasks.map(t => t.status).filter(Boolean)));

  const displayedTasks = tasks
    .filter(t => filterStatus === 'all' || t.status === filterStatus)
    .sort((a, b) => {
      const aName = (a['Candidate Name'] || '').toLowerCase();
      const bName = (b['Candidate Name'] || '').toLowerCase();
      if (aName < bName) return sortAsc ? -1 : 1;
      if (aName > bName) return sortAsc ? 1 : -1;
      return 0;
    });

  return (
    <DashboardLayout>
      <div className="p-4 space-y-4">
        <h2 className="text-xl font-semibold">Today's Tasks</h2>
        {error && <p className="text-red-500 mb-2">{error}</p>}

        {tasks.length === 0 ? (
          <p>No tasks found</p>
        ) : (
          <>
            <div className="flex gap-4 items-center">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {statuses.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => setSortAsc(!sortAsc)}>
                Sort {sortAsc ? 'A-Z' : 'Z-A'}
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Candidate Name</TableHead>
                  <TableHead>Date of Interview</TableHead>
                  <TableHead>Start Time</TableHead>
                  <TableHead>End Time</TableHead>
                  <TableHead>End Client</TableHead>
                  <TableHead>Round</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayedTasks.map((task) => (
                  <TableRow key={task._id} className={getRowBg(task.status || '')}>
                    <TableCell>{DOMPurify.sanitize(task.subject || '')}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task['Candidate Name'] || '')}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task['Date of Interview'] || '')}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task['Start Time Of Interview'] || '')}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task['End Time Of Interview'] || '')}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task['End Client'] || '')}</TableCell>
                    <TableCell>{DOMPurify.sanitize(task['Interview Round'] || '')}</TableCell>
                    <TableCell>
                      {task.status && (
                        <Badge className={getStatusBadge(task.status)}>{task.status}</Badge>
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
