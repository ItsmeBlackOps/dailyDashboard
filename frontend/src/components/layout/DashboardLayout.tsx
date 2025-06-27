import { useState } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { ThemeProvider } from '@/hooks/useTheme';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  return (
    <ThemeProvider>
      <div className="h-screen flex flex-col">
        <Header toggleSidebar={toggleSidebar} />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar isOpen={sidebarOpen} toggleSidebar={toggleSidebar} />
          <main className="flex-1 overflow-auto p-4">{children}</main>
        </div>
      </div>
    </ThemeProvider>
  );
}
