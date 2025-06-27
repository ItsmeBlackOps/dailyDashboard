import { NavLink } from 'react-router-dom';
import { LayoutDashboard, LogOut, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/hooks/useAuth';

interface SidebarProps {
  isOpen: boolean;
  toggleSidebar: () => void;
}

export function Sidebar({ isOpen, toggleSidebar }: SidebarProps) {
  const isMobile = useIsMobile();
  const { logout } = useAuth();

  if (isMobile && !isOpen) return null;

  return (
    <>
      {isMobile && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
          onClick={toggleSidebar}
        />
      )}
      <aside
        className={cn(
          'bg-sidebar border-r border-border z-50 flex flex-col transition-all',
          isMobile ? 'fixed inset-y-0 left-0 w-64' : 'w-64'
        )}
      >
        <div className="flex h-16 items-center border-b border-border px-4">
          <Button
            onClick={toggleSidebar}
            variant="ghost"
            size="icon"
            className="md:hidden"
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Toggle sidebar</span>
          </Button>
          <span className="font-bold text-lg ml-2">Dashboard</span>
        </div>
        <nav className="flex-1 p-2">
          <NavLink
            to="/dashboard"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-sidebar-foreground/80 hover:text-sidebar-foreground'
              )
            }
          >
            <LayoutDashboard className="h-5 w-5" />
            <span>Tasks</span>
          </NavLink>
        </nav>
        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            className="flex items-center gap-3 w-full justify-start"
            onClick={logout}
          >
            <LogOut className="h-5 w-5" />
            <span>Logout</span>
          </Button>
        </div>
      </aside>
    </>
  );
}
