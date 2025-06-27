import { useEffect, useState } from "react";
import Tasks from "./Tasks";
import SignIn from "./pages/auth/SignIn";
import { AuthProvider, useAuth } from "@/hooks/useAuth";

function Content() {
  const { token } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    async function fetchTasks() {
      if (!token) return;
      const res = await fetch("http://localhost:3000/tasks/today", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    }
    fetchTasks();
  }, [token]);

  if (!token) {
    return <SignIn />;
  }
  return <Tasks tasks={tasks} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Content />
    </AuthProvider>
  );
}
