import { Header } from './Header';
import { ThemeProvider } from '@/hooks/useTheme';
import { TabProvider } from '@/hooks/useTabs';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <ThemeProvider>
      <TabProvider>
        <div className="h-screen flex flex-col">
          <Header />
          <main className="flex-1 overflow-auto p-4">{children}</main>
        </div>
      </TabProvider>
    </ThemeProvider>
  );
}
