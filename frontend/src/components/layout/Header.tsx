import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useTab } from '@/hooks/useTabs';
import { useEffect, useMemo } from 'react';

export function Header() {
  const { logout } = useAuth();
  const { selectedTab, setSelectedTab } = useTab();
  const STORAGE_KEY = 'tab';

  // restore on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setSelectedTab(saved as any);
  }, [setSelectedTab]);

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
    <header className="sticky top-0 z-30 bg-background border-b border-border h-16 flex items-center px-4 shadow-sm">
      <Link to="/dashboard" className="ml-2 text-xl font-bold">
        Daily Dashboard
      </Link>

      {showTabs && (
        <Tabs
          value={selectedTab}
          onValueChange={handleTabChange}
          className="ml-4"
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
