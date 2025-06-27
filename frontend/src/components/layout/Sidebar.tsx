import { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, BarChart3, MessageSquare, Calendar, Settings, LogOut, ChevronLeft, ChevronRight, LifeBuoy, TrendingUp, FileText, UserPlus, Target, ClipboardList, ChevronDown, User, AlertTriangle, Award, Navigation, MousePointer, CalendarDays, CreditCard, ImageIcon, Menu, GanttChart, List, Square, PanelLeftOpen, BarChart, Image, Loader, Zap, HelpCircle, Type, MessageCircle, Eye, ArrowUpDown, Lock, UserCheck, KeyRound, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { useIsMobile } from '@/hooks/use-mobile';
import { Link, useLocation } from 'react-router-dom';
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
  const isActive = location.pathname === href || (href === '/' && location.pathname === '/');

  return (
    <NavLink
      to={href}
      end={href === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent',
          isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium' : 'text-sidebar-foreground/80 hover:text-sidebar-foreground'
        )
      }
      data-nav-item={href}
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      {!isCollapsed && (
        <div className="flex items-center justify-between w-full">
          <span>{label}</span>
          {badge && <Badge variant="secondary" className="ml-auto text-xs">{badge}</Badge>}
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

  const handleToggleCollapse = () => {
    if (!isMobile) {
      setIsCollapsed(!isCollapsed);
    } else {
      toggleSidebar();
    }
  };

  // Scroll to active navigation item
  useEffect(() => {
    if (scrollAreaRef.current) {
      const activeNavItem = scrollAreaRef.current.querySelector(`[data-nav-item="${location.pathname}"]`) as HTMLElement;
      
      if (activeNavItem) {
        // Get the scrollable container
        const scrollContainer = scrollAreaRef.current;
        const containerRect = scrollContainer.getBoundingClientRect();
        const itemRect = activeNavItem.getBoundingClientRect();
        
        // Calculate if the item is visible
        const isItemVisible = (
          itemRect.top >= containerRect.top &&
          itemRect.bottom <= containerRect.bottom
        );
        
        // If not visible, scroll to make it visible
        if (!isItemVisible) {
          const scrollTop = activeNavItem.offsetTop - scrollContainer.clientHeight / 2 + activeNavItem.clientHeight / 2;
          scrollContainer.scrollTo({
            top: Math.max(0, scrollTop),
            behavior: 'smooth'
          });
        }
      }
    }
  }, [location.pathname, isOpen]);

  // Hide completely on mobile when closed
  if (isMobile && !isOpen) {
    return null;
  }

  return (
    <>
      {/* Mobile overlay */}
      {isMobile && isOpen && <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm" onClick={toggleSidebar} />}

      <aside
        className={cn(
          'bg-sidebar border-r border-border z-50 transition-all duration-300 ease-in-out flex flex-col',
          isMobile ? (isOpen ? 'fixed inset-y-0 left-0 w-64' : '-translate-x-full') : isCollapsed ? 'w-16' : 'w-64',
          'h-full'
        )}
      >
        {/* Fixed Header */}
        <div className="flex h-16 items-center border-b border-border pl-4 flex-shrink-0">
          <Link to="/" className="flex items-center space-x-2">
            <div className="flex items-center gap-2 overflow-hidden">
              <div className="bg-primary rounded h-8 w-8 flex items-center justify-center text-white font-bold">P</div>
              {!isCollapsed && <span className="font-bold text-lg tracking-tight">PulseCRM</span>}
            </div>
          </Link>

          <Button variant="ghost" size="icon" onClick={handleToggleCollapse} className="ml-auto -mr-4  rounded-full">
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            <span className="sr-only">{isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
          </Button>
        </div>

        {/* Scrollable Content Area - takes remaining space between header and footer */}
        <div ref={scrollAreaRef} className="flex-1 overflow-y-auto p-2 min-h-0">
          <div className="flex flex-col gap-1">
            <nav className="grid gap-1">
              <NavItem icon={LayoutDashboard} label="Dashboard" href="/" isCollapsed={isCollapsed} />
              <NavItem icon={Users} label="Contacts" href="/contacts" isCollapsed={isCollapsed} />
              <NavItem icon={MessageSquare} label="Messages" href="/messages" isCollapsed={isCollapsed} />
              <NavItem icon={Calendar} label="Calendar" href="/calendar" isCollapsed={isCollapsed} />
            </nav>

          

            <Separator className="my-4" />

            {/* CRM Section */}
            {!isCollapsed && (
              <div className="px-3 py-2">
                <h4 className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider">CRM</h4>
              </div>
            )}

            <nav className="grid gap-1">
              <NavItem icon={BarChart3} label="Analytics" href="/analytics" isCollapsed={isCollapsed} />
              <NavItem icon={TrendingUp} label="Deals" href="/deals" isCollapsed={isCollapsed} />
              <NavItem icon={FileText} label="Deal Details" href="/deal-details" isCollapsed={isCollapsed} />
              <NavItem icon={Target} label="Leads" href="/leads" isCollapsed={isCollapsed} />
              <NavItem icon={ClipboardList} label="Lead Details" href="/lead-details" isCollapsed={isCollapsed} />
              <NavItem icon={BarChart3} label="Reports" href="/reports" isCollapsed={isCollapsed} />
              <NavItem icon={FileText} label="Report Details" href="/report-details" isCollapsed={isCollapsed} />
              <NavItem icon={UserPlus} label="Add Contact" href="/add-contact" isCollapsed={isCollapsed} />
            </nav>

            <Separator className="my-4" />

            {/* Authentication Section */}
            {!isCollapsed && (
              <div className="px-3 py-2">
                <h4 className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider">Authentication</h4>
              </div>
            )}

            <nav className="grid gap-1">
              <NavItem icon={Lock} label="Sign In" href="/auth/signin" isCollapsed={isCollapsed} />
              <NavItem icon={UserCheck} label="Sign Up" href="/auth/signup" isCollapsed={isCollapsed} />
              <NavItem icon={KeyRound} label="Forgot Password" href="/auth/forgot-password" isCollapsed={isCollapsed} />
              <NavItem icon={RotateCcw} label="Reset Password" href="/auth/reset-password" isCollapsed={isCollapsed} />
            </nav>

            <Separator className="my-4" />

            {/* Components Section */}
            {!isCollapsed && (
              <div className="px-3 py-2">
                <h4 className="text-xs font-semibold text-sidebar-foreground/70 uppercase tracking-wider">Components</h4>
              </div>
            )}

            <nav className="grid gap-1">
              <NavItem icon={ChevronDown} label="Accordion" href="/components/accordion" isCollapsed={isCollapsed} />
              <NavItem icon={User} label="Avatar" href="/components/avatar" isCollapsed={isCollapsed} />
              <NavItem icon={AlertTriangle} label="Alerts" href="/components/alerts" isCollapsed={isCollapsed} />
              <NavItem icon={Award} label="Badge" href="/components/badge" isCollapsed={isCollapsed} />
              <NavItem icon={Navigation} label="Breadcrumb" href="/components/breadcrumb" isCollapsed={isCollapsed} />
              <NavItem icon={MousePointer} label="Buttons" href="/components/buttons" isCollapsed={isCollapsed} />
              <NavItem icon={CalendarDays} label="Calendar" href="/components/calendar" isCollapsed={isCollapsed} />
              <NavItem icon={CreditCard} label="Card" href="/components/card" isCollapsed={isCollapsed} />
              <NavItem icon={ImageIcon} label="Carousel" href="/components/carousel" isCollapsed={isCollapsed} />
              <NavItem icon={ChevronDown} label="Collapse" href="/components/collapse" isCollapsed={isCollapsed} />
              <NavItem icon={Menu} label="Dropdown" href="/components/dropdown" isCollapsed={isCollapsed} />
              <NavItem icon={GanttChart} label="DHTMLX Gantt" href="/components/gantt" isCollapsed={isCollapsed} badge="New" />
              <NavItem icon={List} label="List Group" href="/components/list-group" isCollapsed={isCollapsed} />
              <NavItem icon={Square} label="Modals" href="/components/modals" isCollapsed={isCollapsed} />
              <NavItem icon={PanelLeftOpen} label="Navs & Tabs" href="/components/navs-tabs" isCollapsed={isCollapsed} />
              <NavItem icon={PanelLeftOpen} label="Offcanvas" href="/components/offcanvas" isCollapsed={isCollapsed} />
              <NavItem icon={BarChart} label="Progress Bar" href="/components/progress" isCollapsed={isCollapsed} />
              <NavItem icon={Image} label="Placeholder" href="/components/placeholder" isCollapsed={isCollapsed} />
              <NavItem icon={ChevronLeft} label="Pagination" href="/components/pagination" isCollapsed={isCollapsed} />
              <NavItem icon={MessageSquare} label="Popovers" href="/components/popovers" isCollapsed={isCollapsed} />
              <NavItem icon={Eye} label="Scrollspy" href="/components/scrollspy" isCollapsed={isCollapsed} />
              <NavItem icon={ArrowUpDown} label="Sortable" href="/components/sortable" isCollapsed={isCollapsed} />
              <NavItem icon={Loader} label="Spinners" href="/components/spinners" isCollapsed={isCollapsed} />
              <NavItem icon={Zap} label="Toast" href="/components/toast" isCollapsed={isCollapsed} />
              <NavItem icon={HelpCircle} label="Tooltips" href="/components/tooltips" isCollapsed={isCollapsed} />
              <NavItem icon={Type} label="Typed Text" href="/components/typed-text" isCollapsed={isCollapsed} />
              <NavItem icon={MessageCircle} label="Chat Widget" href="/components/chat-widget" isCollapsed={isCollapsed} />
            </nav>
          </div>
        </div>

        {/* Fixed Footer */}
        <div className="border-t border-border p-2 flex-shrink-0">
          <nav className="grid gap-1">
            <NavItem icon={Settings} label="Settings" href="/settings" isCollapsed={isCollapsed} />
            <NavItem icon={LifeBuoy} label="Support" href="/support" isCollapsed={isCollapsed} />
            <Button
              variant="ghost"
              className={cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all', 'justify-start text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-accent')}
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