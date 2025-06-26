import { useState } from 'react';
import Login from './Login';
import Tasks from './Tasks';

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);

  async function handleLogin(email: string, password: string) {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error('Login failed');
    const data = await res.json();
    setToken(data.accessToken);
    const tasksRes = await fetch('/tasks/today', {
      headers: { Authorization: `Bearer ${data.accessToken}` },
    });
    if (tasksRes.ok) {
      const t = await tasksRes.json();
      setTasks(t);
    }
  }

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }
  return <Tasks tasks={tasks} />;
}
