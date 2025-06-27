import { Menu, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface HeaderProps {
  toggleSidebar: () => void;
}

export function Header({ toggleSidebar }: HeaderProps) {
  const { logout } = useAuth();
  return (
    <header className="sticky top-0 z-30 bg-background border-b border-border h-16 flex items-center px-4 shadow-sm">
      <Button onClick={toggleSidebar} variant="ghost" size="icon">
        <Menu className="h-5 w-5" />
        <span className="sr-only">Toggle menu</span>
      </Button>
      <Link to="/dashboard" className="ml-2 text-xl font-bold">
        Daily Dashboard
      </Link>
      <Button onClick={logout} variant="ghost" size="sm" className="ml-auto">
        <LogOut className="h-4 w-4 mr-1" />
        Logout
      </Button>
    </header>
  );
}
