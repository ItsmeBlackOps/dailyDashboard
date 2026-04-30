import { useEffect, useRef, useMemo, useState } from "react";
import { useNavigate, NavLink, Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  BarChart3,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  LogOut,
  FileText,
  Database,
  UserPlus,
  KeyRound,
  ClipboardCheck,
  BellRing,
  Sparkles,
  Activity,
  Headphones,
  Briefcase,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDidUpdate } from "@/hooks/useDidUpdate";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { io, Socket } from "socket.io-client";
import { useAuth, API_URL, SOCKET_URL } from "@/hooks/useAuth";
import { UpdateLog, type UpdateLogEntry } from "@/components/dashboard/UpdateLog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

interface SidebarProps {
  isOpen: boolean;
  toggleSidebar: () => void;
}

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  href: string;
  badge?: string;
  showDot?: boolean;
  isOpen: boolean;
  tourId?: string;
}

import { usePostHog } from 'posthog-js/react';
import { useNotifications } from "@/context/NotificationContext";

function NavItem({ icon: Icon, label, href, badge, showDot, isOpen, tourId }: NavItemProps) {
  const location = useLocation();
  const posthog = usePostHog();
  const role = localStorage.getItem("role") || "unknown";

  const handleClick = () => {
    posthog.capture('sidebar_navigation_clicked', {
      destination: href,
      label: label,
      user_role: role
    });
  };

  return (
    <NavLink
      to={href}
      end={href === "/"}
      onClick={handleClick}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-white/5",
          isActive
            ? "bg-primary/20 text-primary shadow-[0_0_15px_-3px_rgba(var(--primary),0.4)] font-semibold border border-primary/20"
            : "text-muted-foreground hover:text-foreground"
        )
      }
      data-nav-item={href}
      data-tour-id={tourId}
      aria-current={location.pathname === href ? "page" : undefined}
      title={label}
    >
      <span className="relative flex-shrink-0">
        <Icon className="h-5 w-5" />
        {(showDot || (!isOpen && !!badge)) && (
          <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-background" />
        )}
      </span>
      {isOpen && (
        <div className="flex items-center justify-between w-full min-w-0">
          <span className="truncate">{label}</span>
          {badge && (
            <Badge variant="secondary" className="ml-2 text-xs">
              {badge}
            </Badge>
          )}
        </div>
      )}
    </NavLink>
  );
}

export function Sidebar({ isOpen, toggleSidebar }: SidebarProps) {
  const isMobile = useIsMobile();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const role = useMemo(() => localStorage.getItem("role") || "", []);
  const normalizedRole = role.trim().toLowerCase();
  const navigate = useNavigate();
  const { authFetch, refreshAccessToken } = useAuth();
  const [resumeCount, setResumeCount] = useState<number>(0);
  const [adminAlertCount, setAdminAlertCount] = useState<number>(0);
  const resumeSocketRef = useRef<Socket | null>(null);
  const adminAlertSocketRef = useRef<Socket | null>(null);
  const currentUserEmail = useMemo(() => (localStorage.getItem("email") || "").trim().toLowerCase(), []);
  const showResumeNav = useMemo(
    () => ["expert", "user", "lead", "am", "recruiter", "manager", "admin", "mlead", "mam", "mm"].includes(normalizedRole),
    [normalizedRole]
  );
  const shouldFilterResumeEvents = useMemo(
    () => !["lead", "am", "recruiter", "manager", "admin", "mlead", "mam", "mm"].includes(normalizedRole),
    [normalizedRole]
  );

  const { notifications } = useNotifications();
  const hasResumeUnread = useMemo(() => {
    return notifications.some(n =>
      !n.read &&
      n.type === 'comment' &&
      n.resumeUnderstandingStatus === 'pending'
    );
  }, [notifications]);

  const [isUpdateLogOpen, setIsUpdateLogOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordValue, setPasswordValue] = useState('');
  const [confirmValue, setConfirmValue] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const updateEntries = useMemo<UpdateLogEntry[]>(
    () => [
      {
        id: '2024-09-27-admin-alerts-roster',
        title: 'Admin Alerts roster improvements',
        description: 'Assign experts via dropdown with roster validation; tasks stay visible until resume understanding completes.',
        date: '2024-09-27',
        tags: ['Admin Alerts']
      },
      {
        id: '2024-09-27-branch-admin-access',
        title: 'Admin access to branch candidates',
        description: 'Admins can now review the branch pipeline alongside branch roles without losing edit safeguards.',
        date: '2024-09-27',
        tags: ['Branch Candidates']
      },
      {
        id: '2024-09-27-dashboard-filters-inline',
        title: 'Dashboard filter layout refined',
        description: 'Time range, date field, and day picker align on one line for quicker switching on every screen size.',
        date: '2024-09-27',
        tags: ['Dashboard']
      }
    ],
    []
  );

  // Scroll the active nav item into view on route change
  useEffect(() => {
    if (!scrollAreaRef.current) return;

    const activeNavItem = scrollAreaRef.current.querySelector(
      `[data-nav-item="${location.pathname}"]`
    ) as HTMLElement | null;

    if (!activeNavItem) return;

    const scrollContainer = scrollAreaRef.current;
    const containerRect = scrollContainer.getBoundingClientRect();
    const itemRect = activeNavItem.getBoundingClientRect();

    const isItemVisible =
      itemRect.top >= containerRect.top &&
      itemRect.bottom <= containerRect.bottom;

    if (!isItemVisible) {
      const scrollTop =
        activeNavItem.offsetTop -
        scrollContainer.clientHeight / 2 +
        activeNavItem.clientHeight / 2;

      scrollContainer.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: "smooth",
      });
    }
  }, [location.pathname, isOpen]);

  // Auto-close on mobile when the route changes — otherwise the sidebar
  // stays over the page content until the user clicks the backdrop.
  // useDidUpdate skips the initial mount so we don't slam-close on load.
  useDidUpdate(() => {
    if (isMobile && isOpen) toggleSidebar();
  }, [location.pathname]);

  useEffect(() => {
    if (!showResumeNav) {
      setResumeCount(0);
      if (resumeSocketRef.current) {
        resumeSocketRef.current.disconnect();
        resumeSocketRef.current = null;
      }
      return;
    }

    const token = localStorage.getItem('accessToken') || '';
    const socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { token }
    });

    resumeSocketRef.current = socket;

    const requestCount = () => {
      socket.emit('getResumeUnderstandingCount', { status: 'pending' }, (response: { success: boolean; count?: number }) => {
        if (!response?.success) {
          return;
        }
        setResumeCount(typeof response.count === 'number' ? response.count : 0);
      });
    };

    const handleAssignment = (payload: { candidate?: { expertRaw?: string } }) => {
      if (shouldFilterResumeEvents) {
        const expert = (payload?.candidate?.expertRaw || '').trim().toLowerCase();
        if (expert && expert !== currentUserEmail) {
          return;
        }
      }
      requestCount();
    };

    const handleUpdate = (payload: { candidate?: { expertRaw?: string } }) => {
      if (shouldFilterResumeEvents) {
        const expert = (payload?.candidate?.expertRaw || '').trim().toLowerCase();
        if (expert && expert !== currentUserEmail) {
          return;
        }
      }
      requestCount();
    };

    const handleConnect = () => requestCount();

    const handleAuthError = async (err: Error) => {
      if (err.message !== 'Unauthorized') return;
      const ok = await refreshAccessToken();
      if (!ok) {
        return;
      }
      socket.auth = { token: localStorage.getItem('accessToken') || '' };
      socket.once('connect', requestCount);
      socket.connect();
    };

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleAuthError);
    socket.on('resumeUnderstandingAssigned', handleAssignment);
    socket.on('resumeUnderstandingUpdated', handleUpdate);

    socket.connect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleAuthError);
      socket.off('resumeUnderstandingAssigned', handleAssignment);
      socket.off('resumeUnderstandingUpdated', handleUpdate);
      socket.disconnect();
      resumeSocketRef.current = null;
    };
  }, [showResumeNav, refreshAccessToken, currentUserEmail, shouldFilterResumeEvents]);

  useEffect(() => {
    if (normalizedRole !== 'admin') {
      setAdminAlertCount(0);
      if (adminAlertSocketRef.current) {
        adminAlertSocketRef.current.disconnect();
        adminAlertSocketRef.current = null;
      }
      return;
    }

    const token = localStorage.getItem('accessToken') || '';
    const socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ['websocket'],
      auth: { token }
    });

    adminAlertSocketRef.current = socket;

    const requestCount = () => {
      socket.emit('getPendingExpertAssignmentsCount', (response: { success: boolean; count?: number }) => {
        if (!response?.success) {
          return;
        }
        setAdminAlertCount(typeof response.count === 'number' ? response.count : 0);
      });
    };

    const handleConnect = () => requestCount();

    const handleAuthError = async (err: Error) => {
      if (err.message !== 'Unauthorized') return;
      const ok = await refreshAccessToken();
      if (!ok) {
        return;
      }
      socket.auth = { token: localStorage.getItem('accessToken') || '' };
      socket.once('connect', requestCount);
      socket.connect();
    };

    const handleAssignmentsChange = () => requestCount();

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleAuthError);
    socket.on('candidateExpertAssigned', handleAssignmentsChange);
    socket.on('candidateResumeStatusChanged', handleAssignmentsChange);

    socket.connect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleAuthError);
      socket.off('candidateExpertAssigned', handleAssignmentsChange);
      socket.off('candidateResumeStatusChanged', handleAssignmentsChange);
      socket.disconnect();
      adminAlertSocketRef.current = null;
    };
  }, [normalizedRole, refreshAccessToken]);

  return (
    <>
      {/* Mobile overlay */}
      {isMobile && isOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "glass-panel z-50 transition-all duration-300 ease-in-out flex flex-col h-full overflow-hidden",
          isMobile
            ? isOpen
              ? "fixed inset-y-0 left-0 w-64"
              : "-translate-x-full w-64"
            : isOpen
              ? "w-64"
              : "w-16"
        )}
        aria-label="Sidebar"
        aria-expanded={isOpen}
      >
        {/* Header */}
        <div className="flex h-16 items-center border-b border-border pl-4 pr-2 flex-shrink-0">
          <Link to="/" className="flex items-center space-x-2 overflow-hidden">
            <div className="rounded h-8 w-8 flex items-center justify-center text-white font-bold">
              <img
                className="h-8 w-8 object-contain"
                src="https://egvjgtfjstxgszpzvvbx.supabase.co/storage/v1/object/public/images//20250610_1111_3D%20Gradient%20Logo_remix_01jxd69dc9ex29jbj9r701yjkf%20(2).png"
                alt="SilverspaceCRM"
              />
            </div>
            {isOpen && (
              <span className="font-bold text-lg tracking-tight truncate">
                SilverspaceCRM
              </span>
            )}
          </Link>

          {/* Collapse/Expand toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="ml-auto rounded-full"
            aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            {isOpen ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Scrollable nav */}
        <div ref={scrollAreaRef} className="flex-1 overflow-y-auto p-2 min-h-0">
          <div className="flex flex-col gap-1">
            <nav className="grid gap-1">
              <NavItem
                icon={LayoutDashboard}
                label="Dashboard"
                href="/"
                isOpen={isOpen}
              />
              <NavItem
                icon={ClipboardList}
                label="Tasks"
                href="/tasks"
                isOpen={isOpen}
                tourId="tasks-link"
              />
              {['admin', 'mm', 'mam', 'mlead', 'lead', 'user', 'am', 'recruiter', 'manager'].includes(normalizedRole) && (
                <NavItem
                  icon={Database}
                  label="Branch Candidates"
                  href="/branch-candidates"
                  isOpen={isOpen}
                />
              )}
              {/* Jobs — admin + marketing team + recruiter */}
              {['admin', 'mm', 'mam', 'mlead', 'recruiter'].includes(normalizedRole) && (
                <NavItem
                  icon={Briefcase}
                  label="Jobs"
                  href="/jobs"
                  isOpen={isOpen}
                />
              )}
              {/* Admin Alerts is admin-only */}
              {normalizedRole === 'admin' && (
                <NavItem
                  icon={BellRing}
                  label="Admin Alerts"
                  href="/admin-alerts"
                  isOpen={isOpen}
                  badge={adminAlertCount > 0 ? String(adminAlertCount) : undefined}
                />
              )}
              {showResumeNav && (
                <NavItem
                  icon={ClipboardCheck}
                  label="Resume Understanding"
                  href="/resume-understanding"
                  isOpen={isOpen}
                  badge={resumeCount > 0 ? String(resumeCount) : undefined}
                  showDot={hasResumeUnread}
                />
              )}
            </nav>

            <Separator className="my-4" />

            <nav className="grid gap-1">
              {['mam', 'mm', 'admin', 'mtl'].includes(normalizedRole) && (
                <>
                  <NavItem
                    icon={BarChart3}
                    label="Reports"
                    href="/reports"
                    isOpen={isOpen}
                  />
                  <NavItem
                    icon={FileText}
                    label="Report Assistant"
                    href="/reports/assistant"
                    isOpen={isOpen}
                  />
                </>
              )}
              {['admin', 'mam', 'mm', 'mlead', 'recruiter'].includes(normalizedRole) && (
                <NavItem
                  icon={LayoutDashboard}
                  label="Profile Hub"
                  href="/profile-hub"
                  isOpen={isOpen}
                />
              )}
              {normalizedRole === 'admin' && (
                <NavItem
                  icon={Activity}
                  label="Performance"
                  href="/admin/performance"
                  isOpen={isOpen}
                />
              )}
              {currentUserEmail === 'harsh.patel@silverspaceinc.com' && (
                <NavItem
                  icon={Headphones}
                  label="Interview Support"
                  href="/admin/interview-support"
                  isOpen={isOpen}
                />
              )}
            </nav>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border p-2 flex-shrink-0">
          <nav className="grid gap-1">
            {['admin', 'manager', 'mm', 'mam', 'mlead', 'lead', 'am'].includes(normalizedRole) && (
              <NavItem
                icon={UserPlus}
                label="User Management"
                href="/user-management"
                isOpen={isOpen}
                tourId="user-management-link"
              />
            )}
            <Button
              variant="ghost"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                "justify-start text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-accent"
              )}
              onClick={() => setIsUpdateLogOpen(true)}
            >
              <Sparkles className="h-5 w-5 flex-shrink-0" />
              {isOpen && <span>What's New</span>}
            </Button>
            <Button
              variant="ghost"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                "justify-start text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-accent"
              )}
              onClick={() => {
                setPasswordValue('');
                setConfirmValue('');
                setPasswordError('');
                setPasswordSuccess('');
                setIsPasswordModalOpen(true);
              }}
            >
              <KeyRound className="h-5 w-5 flex-shrink-0" />
              {isOpen && <span>Change Password</span>}
            </Button>
            <Button
              variant="ghost"
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all",
                "justify-start text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-accent"
              )}
              onClick={() => {
                localStorage.clear();
                navigate("/auth/signin");
              }}
            >
              <LogOut className="h-5 w-5 flex-shrink-0" />
              {isOpen && <span>Logout</span>}
            </Button>
          </nav>
        </div>
      </aside>

      <Dialog open={isUpdateLogOpen} onOpenChange={setIsUpdateLogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Product Updates</DialogTitle>
            <DialogDescription>Latest improvements across the dashboard experience.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto">
            <UpdateLog updates={updateEntries} storageKey="sidebar-update-log" />
          </div>
          <DialogFooter>
            <Button onClick={() => setIsUpdateLogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Update Password</DialogTitle>
            <DialogDescription>Choose a new password. All sessions will be signed out after the update.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="sidebar-new-password">
                New Password
              </label>
              <input
                id="sidebar-new-password"
                type="password"
                value={passwordValue}
                onChange={(event) => {
                  setPasswordValue(event.target.value);
                  setPasswordError('');
                  setPasswordSuccess('');
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Enter new password"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="sidebar-confirm-password">
                Confirm Password
              </label>
              <input
                id="sidebar-confirm-password"
                type="password"
                value={confirmValue}
                onChange={(event) => {
                  setConfirmValue(event.target.value);
                  setPasswordError('');
                  setPasswordSuccess('');
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Re-enter new password"
              />
            </div>
            {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
            {passwordSuccess && <p className="text-sm text-aurora-emerald">{passwordSuccess}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setIsPasswordModalOpen(false)}
              disabled={passwordSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const trimmed = passwordValue.trim();
                if (!trimmed) {
                  setPasswordError('Enter a new password');
                  return;
                }
                if (trimmed !== confirmValue.trim()) {
                  setPasswordError('Passwords do not match');
                  return;
                }
                if (!/[A-Z]/.test(trimmed) || !/[a-z]/.test(trimmed) || !/[0-9]/.test(trimmed) || trimmed.length < 8) {
                  setPasswordError('Password must be at least 8 characters with upper, lower case letters and a number');
                  return;
                }
                if (!currentUserEmail) {
                  setPasswordError('Unable to resolve current user');
                  return;
                }
                try {
                  setPasswordSubmitting(true);
                  setPasswordError('');
                  const response = await authFetch(`${API_URL}/api/users/profile/${encodeURIComponent(currentUserEmail)}/password`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: trimmed })
                  });
                  if (!response.ok) {
                    const data = await response.json().catch(() => ({ error: 'Unable to update password' }));
                    throw new Error(data?.error || 'Unable to update password');
                  }
                  setPasswordSuccess('Password updated. Please sign in again on other devices.');
                  setPasswordValue('');
                  setConfirmValue('');
                } catch (error) {
                  setPasswordError(error instanceof Error ? error.message : 'Unable to update password');
                } finally {
                  setPasswordSubmitting(false);
                }
              }}
              disabled={passwordSubmitting}
            >
              {passwordSubmitting ? 'Saving…' : 'Save Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
