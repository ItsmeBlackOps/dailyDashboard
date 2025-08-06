import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { DashboardStats } from '@/components/dashboard/DashboardStats';
import { SalesPipeline } from '@/components/dashboard/SalesPipeline';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { TopAgents } from '@/components/dashboard/TopAgents';
import { RevenueChart } from '@/components/dashboard/RevenueChart';

const Index = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-2">Dashboard Overview</h1>
          <p className="text-muted-foreground">Welcome back! Here's what's happening with your sales today.</p>
        </div>

        <DashboardStats />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="col-span-2">
            <RevenueChart />
          </div>
          <div className="col-span-1">
            <TopAgents />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="col-span-1">
            <SalesPipeline />
          </div>
          <div className="col-span-1 lg:col-span-2">
            <ActivityFeed />
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Index;
