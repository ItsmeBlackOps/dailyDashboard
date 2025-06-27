import { Bell, Search, Menu, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Link } from 'react-router-dom';
interface HeaderProps {
  toggleSidebar: () => void;
  openSettings: () => void;
}

export function Header({ toggleSidebar, openSettings }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-background border-b border-border h-16 flex items-center px-4 md:px-6 shadow-sm">
      <div className="flex items-center gap-2 md:gap-4 w-full">
        <Button onClick={toggleSidebar} variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle menu</span>
        </Button>

        <div className="hidden md:flex md:w-[240px]">
          <Link to="/" className="flex items-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight">PulseCRM</h1>
          </Link>
        </div>

        <div className="flex items-center md:ml-auto md:gap-4 gap-2">
          <div className="relative hidden md:flex md:flex-1 max-w-md">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input type="search" placeholder="Search..." className="pl-8 bg-muted/30 border-muted focus-visible:ring-primary" />
          </div>

          <ThemeToggle />

          <Button variant="ghost" size="icon" className="relative">
            <Bell className="h-5 w-5" />
            <span className="sr-only">Notifications</span>
            <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center bg-crm-accent">3</Badge>
          </Button>

          <Button variant="ghost" size="icon" onClick={openSettings}>
            <Settings className="h-5 w-5" />
            <span className="sr-only">Settings</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarImage src="" alt="User" />
                  <AvatarFallback className="bg-primary text-white">JD</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Profile</DropdownMenuItem>
              <DropdownMenuItem>Settings</DropdownMenuItem>
              <DropdownMenuItem>Billing</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
