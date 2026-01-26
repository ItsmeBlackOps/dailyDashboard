import React, { useEffect, useState } from 'react';
import { Header } from './Header';
import { ThemeProvider } from '@/hooks/useTheme';
import { Sidebar } from '@/components/layout/Sidebar';
import { UserProfileProvider } from '@/contexts/UserProfileContext';
import { useToast } from '@/hooks/use-toast';
import { NotificationProvider } from '@/context/NotificationContext';
import { NotificationDetailModal } from '@/components/ui/notification-modal';

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
  const { toast } = useToast();

  const toggleSidebar = () => setSidebarOpen(v => !v);
  const openSettings = () => setSettingsOpen(true);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(sidebarOpen));
  }, [sidebarOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const pending = window.localStorage.getItem('supportAnnouncementPending');
      if (pending === 'true') {
        toast({
          title: 'Interview support is live',
          description: 'Visit Branch Candidates to request interview support and complete your profile for a branded email signature.',
        });
        window.localStorage.removeItem('supportAnnouncementPending');
      }
    } catch {
      // Ignore storage errors
    }
  }, [toast]);

  return (
    <ThemeProvider>
      <UserProfileProvider>
        <NotificationProvider>
          <div className="h-screen flex flex-col">
            <Header toggleSidebar={toggleSidebar} openSettings={openSettings} />

            {/* Keep sidebar beside main, not under header */}
            <div className="flex flex-1 overflow-hidden">
              <Sidebar isOpen={sidebarOpen} toggleSidebar={toggleSidebar} />
              <main className="flex-1 overflow-auto p-4 md:p-6">
                {children}
              </main>
            </div>
            <NotificationDetailModal />
          </div>
        </NotificationProvider>
      </UserProfileProvider>
    </ThemeProvider>
  );
}
