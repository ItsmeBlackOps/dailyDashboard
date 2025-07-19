import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useTab } from '@/hooks/useTabs';

export function Header() {
  const { logout } = useAuth();
  const { selectedTab, setSelectedTab } = useTab();
  return (
    <header className="sticky top-0 z-30 bg-background border-b border-border h-16 flex items-center px-4 shadow-sm">
      <Link to="/dashboard" className="ml-2 text-xl font-bold">
        Daily Dashboard
      </Link>
      <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as any)} className="ml-4">
        <TabsList>
          <TabsTrigger value="first">First</TabsTrigger>
          <TabsTrigger value="second">Second</TabsTrigger>
        </TabsList>
      </Tabs>
      <Button onClick={logout} variant="ghost" size="sm" className="ml-auto">
        <LogOut className="h-4 w-4 mr-1" />
        Logout
      </Button>
    </header>
  );
}
