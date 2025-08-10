import { useState, useEffect, useRef, useMemo } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Settings,
  LifeBuoy,
  LogOut,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { useIsMobile } from '@/hooks/use-mobile';
import { Badge } from '@/components/ui/badge';

interface SidebarProps {
  isOpen: boolean;
  toggleSidebar: () => void;
}

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  href: string;
  isCollapsed?: boolean;
  badge?: string;
}

function NavItem({ icon: Icon, label, href, isCollapsed, badge }: NavItemProps) {
  const location = useLocation();

  return (
    <NavLink
      to={href}
      end={href === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent',
          isActive
            ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
            : 'text-sidebar-foreground/80 hover:text-sidebar-foreground'
        )
      }
      data-nav-item={href}
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      {!isCollapsed && (
        <div className="flex items-center justify-between w-full">
          <span>{label}</span>
          {badge && (
            <Badge variant="secondary" className="ml-auto text-xs">
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
  const [isCollapsed, setIsCollapsed] = useState(false);
  const location = useLocation();
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const role = useMemo(() => localStorage.getItem('role'), []);

  const handleToggleCollapse = () => {
    if (!isMobile) setIsCollapsed((v) => !v);
    else toggleSidebar();
  };

  // Scroll to active nav item
  useEffect(() => {
    if (scrollAreaRef.current) {
      const activeNavItem = scrollAreaRef.current.querySelector(
        `[data-nav-item="${location.pathname}"]`
      ) as HTMLElement | null;

      if (activeNavItem) {
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
            behavior: 'smooth',
          });
        }
      }
    }
  }, [location.pathname, isOpen]);

  // Hide completely on mobile when closed
  if (isMobile && !isOpen) return null;

  return (
    <>
      {/* Mobile overlay */}
      {isMobile && isOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
          onClick={toggleSidebar}
        />
      )}

      <aside
        className={cn(
          'bg-sidebar border-r border-border z-50 transition-all duration-300 ease-in-out flex flex-col h-full',
          isMobile
            ? isOpen
              ? 'fixed inset-y-0 left-0 w-64'
              : '-translate-x-full'
            : isCollapsed
            ? 'w-16'
            : 'w-64'
        )}
      >
        {/* Fixed Header */}
        <div className="flex h-16 items-center border-b border-border pl-4 flex-shrink-0">
          <Link to="/" className="flex items-center space-x-2">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="rounded h-8 w-8 flex items-center justify-center text-white font-bold">
                <img src="https://egvjgtfjstxgszpzvvbx.supabase.co/storage/v1/object/public/images//20250610_1111_3D%20Gradient%20Logo_remix_01jxd69dc9ex29jbj9r701yjkf%20(2).png" alt="SilverspaceCRM" />
              </div>
              {!isCollapsed && (
                <span className="font-bold text-lg tracking-tight">
                  SilverspaceCRM
                </span>
              )}
            </div>
          </Link>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleToggleCollapse}
          className="ml-auto -mr-4 rounded-full"
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
          <span className="sr-only">
            {isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          </span>
        </Button>
        </div>

        {/* Scrollable Content */}
        <div ref={scrollAreaRef} className="flex-1 overflow-y-auto p-2 min-h-0">
          <div className="flex flex-col gap-1">
            {/* Primary nav */}
            <nav className="grid gap-1">
              {/* Dashboard ONLY for Admin */}
              {role === 'admin' && (
                <NavItem
                  icon={LayoutDashboard}
                  label="Dashboard"
                  href="/"
                  isCollapsed={isCollapsed}
                />
              )}

              {/* Tasks for everyone */}
              <NavItem
                icon={ClipboardList}
                label="Tasks"
                href="/tasks"
                isCollapsed={isCollapsed}
              />
            </nav>

            <Separator className="my-4" />

            {/* (Optional) You can keep or remove more sections below as needed */}
          </div>
        </div>

        {/* Fixed Footer */}
        <div className="border-t border-border p-2 flex-shrink-0">
          <nav className="grid gap-1">
            {/* <NavItem
              icon={Settings}
              label="Settings"
              href="/settings"
              isCollapsed={isCollapsed}
            />
            <NavItem
              icon={LifeBuoy}
              label="Support"
              href="/support"
              isCollapsed={isCollapsed}
            /> */}
            <Button
              variant="ghost"
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all',
                'justify-start text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-accent'
              )}
              onClick={() => {
                // if you have useAuth().logout, call that here instead
                localStorage.clear();
                window.location.href = '/auth/signin';
              }}
            >
              <LogOut className="h-5 w-5 flex-shrink-0" />
              {!isCollapsed && <span>Logout</span>}
            </Button>
          </nav>
        </div>
      </aside>
    </>
  );
}
