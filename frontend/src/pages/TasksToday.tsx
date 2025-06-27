import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/hooks/useAuth';

interface Task {
  assignedEmail?: string;
  Subject?: string;
  'Candidate Name'?: string;
  'Date of Interview'?: string;
  'Start Time Of Interview'?: string;
  'End Time Of Interview'?: string;
  'End Client'?: string;
  'Round of Interview'?: string;
}

export default function TasksToday() {
  const { authFetch } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await authFetch('http://localhost:3000/tasks/today');
        if (!res.ok) throw new Error('Failed to load tasks');
        const data = await res.json();
        setTasks(data);
      } catch (err) {
        setError((err as Error).message);
      }
    };
    load();
  }, [authFetch]);

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
                  {tasks.map((task, idx) => (
                    <TableRow key={idx}>
                      <TableCell>{DOMPurify.sanitize(task.Subject || '')}</TableCell>
                      <TableCell>{DOMPurify.sanitize(task['Candidate Name'] || '')}</TableCell>
                      <TableCell>{DOMPurify.sanitize(task['Date of Interview'] || '')}</TableCell>
                      <TableCell>{DOMPurify.sanitize(task['Start Time Of Interview'] || '')}</TableCell>
                      <TableCell>{DOMPurify.sanitize(task['End Time Of Interview'] || '')}</TableCell>
                      <TableCell>{DOMPurify.sanitize(task['End Client'] || '')}</TableCell>
                      <TableCell>{DOMPurify.sanitize(task['Round of Interview'] || '')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
      </div>
    </DashboardLayout>
  );
}
