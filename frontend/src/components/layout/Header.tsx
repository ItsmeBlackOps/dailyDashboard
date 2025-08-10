import { LogOut, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useTab } from '@/hooks/useTabs';
import { useEffect, useMemo } from 'react';

interface HeaderProps {
  toggleSidebar: () => void;
  openSettings?: () => void; // keep if you plan to use it later
}

export function Header({ toggleSidebar }: HeaderProps) {
  const { logout } = useAuth();
  const { selectedTab, setSelectedTab } = useTab();
  const STORAGE_KEY = 'tab';

  // restore on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setSelectedTab(saved as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handler that both updates state _and_ localStorage
  const handleTabChange = (v: string) => {
    setSelectedTab(v as any);
    localStorage.setItem(STORAGE_KEY, v);
    window.location.reload();
  };

  // read role once
  const userRole = useMemo(() => localStorage.getItem('role'), []);
  const showTabs = userRole === 'MM' || userRole === 'MAM';

  return (
    <header className="sticky top-0 z-30 bg-background border-b border-border h-16 flex items-center px-3 md:px-4 shadow-sm gap-2">
      {/* Sidebar toggle */}
      <Button onClick={toggleSidebar} variant="ghost" size="icon" aria-label="Toggle sidebar">
        <Menu className="h-5 w-5" />
      </Button>

      <Link to="/dashboard" className="text-lg md:text-xl font-bold">
        Daily Dashboard
      </Link>

      {showTabs && (
        <Tabs
          value={selectedTab}
          onValueChange={handleTabChange}
          className="ml-2 sm:ml-4"
        >
          <TabsList>
            <TabsTrigger value="Date of Interview">
              Date of Interview
            </TabsTrigger>
            <TabsTrigger value="receivedDateTime">
              Received Date Time
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      <Button onClick={logout} variant="ghost" size="sm" className="ml-auto">
        <LogOut className="h-4 w-4 mr-1" />
        Logout
      </Button>
    </header>
  );
}
