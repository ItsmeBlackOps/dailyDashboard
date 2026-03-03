import React, { useEffect, useState } from 'react';
import { Header } from './Header';
import { ThemeProvider } from '@/hooks/useTheme';
import { Sidebar } from '@/components/layout/Sidebar';
import { UserProfileProvider } from '@/contexts/UserProfileContext';
import { MicrosoftConsentProvider } from '@/contexts/MicrosoftConsentContext';
import { MicrosoftConsentDialog } from '@/components/MicrosoftConsentDialog';
import { useToast } from '@/hooks/use-toast';
import { NotificationDetailModal } from '@/components/ui/notification-modal';
import { RoleDetailRequiredDialog } from './RoleDetailRequiredDialog';
import { RecruiterCallAlertDialog } from './RecruiterCallAlertDialog';

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const seen = window.localStorage.getItem('resumeUnderstandingUpdateSeen_20260128');
      if (!seen) {
        toast({
          title: 'Resume Understanding Update',
          description: 'If you want to send resume understanding for a candidate again, you can click the button and it will be sent.',
          duration: 8000,
        });
        window.localStorage.setItem('resumeUnderstandingUpdateSeen_20260128', 'true');
      }
    } catch {
      // Ignore storage errors
    }
  }, [toast]);

  return (
    <ThemeProvider>
      <MicrosoftConsentProvider>
        <UserProfileProvider>
          <div className="h-screen flex flex-col bg-gradient-to-br from-background via-background to-primary/5 text-foreground">
            <Header toggleSidebar={toggleSidebar} openSettings={openSettings} />

            {/* Keep sidebar beside main, not under header */}
            <div className="flex flex-1 overflow-hidden">
              <Sidebar isOpen={sidebarOpen} toggleSidebar={toggleSidebar} />
              <main className="flex-1 overflow-auto p-4 md:p-6 relative">
                {children}
              </main>
            </div>
            <RoleDetailRequiredDialog />
            <NotificationDetailModal />
            <MicrosoftConsentDialog />
            <RecruiterCallAlertDialog />
          </div>
        </UserProfileProvider>
      </MicrosoftConsentProvider>
    </ThemeProvider>
  );
}
