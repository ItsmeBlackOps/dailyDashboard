import { Header } from './Header';
import { ThemeProvider } from '@/hooks/useTheme';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <ThemeProvider>
        <div className="h-screen flex flex-col">
          <Header />
          <main className="flex-1 overflow-auto p-4">{children}</main>
        </div>
    </ThemeProvider>
  );
}
