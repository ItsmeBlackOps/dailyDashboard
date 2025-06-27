import { useEffect, useState, useRef } from 'react';
import DOMPurify from 'dompurify';
import moment from 'moment-timezone';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  assignedEmail?: string;
}

export default function TasksToday() {
  const { authFetch } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState('');
  const [message, setMessage] = useState('');

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

  // --- load tasks once on mount ---
  const loadTasks = async () => {
    try {
      const res = await authFetch('http://localhost:3000/tasks/today');
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

  return (
    <DashboardLayout>
      <div className="p-4 space-y-4">
        <h2 className="text-xl font-semibold">Today's Tasks</h2>
        {error && <p className="text-red-500 mb-2">{error}</p>}

        {tasks.length === 0 ? (
          <p>No tasks found</p>
        ) : (
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => (
                <TableRow key={task._id}>
                  <TableCell>{DOMPurify.sanitize(task.subject || '')}</TableCell>
                  <TableCell>{DOMPurify.sanitize(task['Candidate Name'] || '')}</TableCell>
                  <TableCell>{DOMPurify.sanitize(task['Date of Interview'] || '')}</TableCell>
                  <TableCell>{DOMPurify.sanitize(task['Start Time Of Interview'] || '')}</TableCell>
                  <TableCell>{DOMPurify.sanitize(task['End Time Of Interview'] || '')}</TableCell>
                  <TableCell>{DOMPurify.sanitize(task['End Client'] || '')}</TableCell>
                  <TableCell>{DOMPurify.sanitize(task['Interview Round'] || '')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        
      </div>
    </DashboardLayout>
  );
}
