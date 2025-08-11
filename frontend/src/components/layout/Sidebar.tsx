import { useEffect, useRef, useMemo } from "react";
import { useNavigate, NavLink, Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  BarChart3,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";

interface SidebarProps {
  isOpen: boolean;
  toggleSidebar: () => void;
}

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  href: string;
  badge?: string;
  isOpen: boolean;
}

function NavItem({ icon: Icon, label, href, badge, isOpen }: NavItemProps) {
  const location = useLocation();

  return (
    <NavLink
      to={href}
      end={href === "/"}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
            : "text-sidebar-foreground/80 hover:text-sidebar-foreground"
        )
      }
      data-nav-item={href}
      aria-current={location.pathname === href ? "page" : undefined}
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
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
  const navigate = useNavigate();

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
          "bg-sidebar border-r border-border z-50 transition-all duration-300 ease-in-out flex flex-col h-full overflow-hidden",
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
              {role === "admin" && (
                <NavItem
                  icon={LayoutDashboard}
                  label="Dashboard"
                  href="/"
                  isOpen={isOpen}
                />
              )}
              <NavItem
                icon={ClipboardList}
                label="Tasks"
                href="/tasks"
                isOpen={isOpen}
              />
            </nav>

            <Separator className="my-4" />

            <nav className="grid gap-1">
              {(role === "MAM" || role === "MM") && (
                <NavItem
                  icon={BarChart3}
                  label="Reports"
                  href="/reports"
                  isOpen={isOpen}
                />
              )}
            </nav>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border p-2 flex-shrink-0">
          <nav className="grid gap-1">
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
    </>
  );
}
