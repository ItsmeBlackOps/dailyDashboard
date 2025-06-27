import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    fetch('http://localhost:3000/tasks/today', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async res => {
        if (!res.ok) throw new Error('Failed to load tasks');
        return res.json();
      })
      .then(data => setTasks(data))
      .catch(err => setError(err.message));
  }, []);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Today\'s Tasks</CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
