import React, { Suspense, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Skeleton } from '@/components/ui/skeleton';
import { ThemeProvider } from '@/hooks/useTheme';
import { Sidebar } from '@/components/layout/Sidebar';
import { UserProfileProvider } from '@/contexts/UserProfileContext';
import { MicrosoftConsentDialog } from '@/components/MicrosoftConsentDialog';
import { TechnicalAckModal } from '@/components/TechnicalAckModal';
import { MeetingStartWarningModal } from '@/components/MeetingStartWarningModal';
import { useToast } from '@/hooks/use-toast';
import { NotificationDetailModal } from '@/components/ui/notification-modal';
import { RoleDetailRequiredDialog } from './RoleDetailRequiredDialog';
import { RecruiterCallAlertDialog } from './RecruiterCallAlertDialog';
import { ContactNumberRequiredDialog } from './ContactNumberRequiredDialog';
import { ExtensionGate } from './ExtensionGate';
import { AnnouncementModal } from './AnnouncementModal';

interface DashboardLayoutProps {
  // Optional: when DashboardLayout is used as a layout *route* (the normal case
  // now) it has no children and renders the matched page via <Outlet/>. The
  // optional-children path keeps the handful of unrouted/legacy pages that
  // still wrap themselves in <DashboardLayout> compiling unchanged.
  children?: React.ReactNode;
}

// Content-area skeleton shown while a lazily-loaded page chunk streams in.
// Scoped to <main> so the shell (sidebar/header) stays on screen — unlike a
// full-viewport splash, which looked like a whole-page reload on every nav.
function ContentSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96" />
      <div className="space-y-3 pt-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
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
      <UserProfileProvider>
        <div className="h-screen flex flex-col bg-gradient-to-br from-background via-background to-primary/5 text-foreground">
          <Header toggleSidebar={toggleSidebar} openSettings={openSettings} />

          {/* Keep sidebar beside main, not under header */}
          <div className="flex flex-1 overflow-hidden">
            <Sidebar isOpen={sidebarOpen} toggleSidebar={toggleSidebar} />
            <main className="flex-1 overflow-auto p-4 md:p-6 relative">
              {children ?? (
                <Suspense fallback={<ContentSkeleton />}>
                  <Outlet />
                </Suspense>
              )}
            </main>
          </div>
          <RoleDetailRequiredDialog />
          <ContactNumberRequiredDialog />
          <ExtensionGate />
          <AnnouncementModal />
          <NotificationDetailModal />
          <MicrosoftConsentDialog />
          <TechnicalAckModal />
          <MeetingStartWarningModal />
          <RecruiterCallAlertDialog />
        </div>
      </UserProfileProvider>
    </ThemeProvider>
  );
}
