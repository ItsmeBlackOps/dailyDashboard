import { useCallback } from 'react';
import { ExternalLink, LogOut, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { API_BASE } from '@/constants';

interface HeaderProps {
  toggleSidebar: () => void;
  openSettings?: () => void; // keep if you plan to use it later
}

export function Header({ toggleSidebar }: HeaderProps) {
  const { logout } = useAuth();
  const openConsentPopup = useCallback(() => {
    const width = 600;
    const height = 700;
    const specs = `noopener,noreferrer,width=${width},height=${height}`;
    const consentUrl = `${API_BASE}/auth/consent`;
    const popup = window.open(consentUrl, 'teams-consent', specs);


  }, []);

  return (
    <header className="sticky top-0 z-30 bg-background border-b border-border h-16 flex items-center px-3 md:px-4 shadow-sm gap-2">
      {/* Sidebar toggle */}
      <Button onClick={toggleSidebar} variant="ghost" size="icon" aria-label="Toggle sidebar">
        <Menu className="h-5 w-5" />
      </Button>

      <Link to="/dashboard" className="text-lg md:text-xl font-bold">
        Daily Dashboard
      </Link>

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />
        <Button onClick={openConsentPopup} variant="ghost" size="sm">
          <ExternalLink className="h-4 w-4 mr-1" />
          Grant Teams Consent
        </Button>
        <Button onClick={logout} variant="ghost" size="sm">
          <LogOut className="h-4 w-4 mr-1" />
          Logout
        </Button>
      </div>
    </header>
  );
}
