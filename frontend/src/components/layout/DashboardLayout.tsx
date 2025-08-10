import { useEffect, useState } from 'react';
import { Header } from './Header';
import { ThemeProvider } from '@/hooks/useTheme';
import { Sidebar } from '@/components/layout/Sidebar';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

const SIDEBAR_KEY = 'sidebarOpen';

export function DashboardLayout({ children }: DashboardLayoutProps) {
  // persist openness across reloads
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    return saved ? saved === 'true' : true;
  });
  const [settingsOpen, setSettingsOpen] = useState(false); // reserved for future use

  const toggleSidebar = () => setSidebarOpen(v => !v);
  const openSettings = () => setSettingsOpen(true);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen));
  }, [sidebarOpen]);

  return (
    <ThemeProvider>
      <div className="h-screen flex flex-col">
        <Header toggleSidebar={toggleSidebar} openSettings={openSettings} />

        {/* Keep sidebar beside main, not under header */}
        <div className="flex flex-1 overflow-hidden">
          <Sidebar isOpen={sidebarOpen} toggleSidebar={toggleSidebar} />
          <main className="flex-1 overflow-auto p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
