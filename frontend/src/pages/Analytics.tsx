
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { AnalyticsOverview } from '@/components/analytics/AnalyticsOverview';
import { SalesAnalytics } from '@/components/analytics/SalesAnalytics';
import { CustomerAnalytics } from '@/components/analytics/CustomerAnalytics';
import { PerformanceMetrics } from '@/components/analytics/PerformanceMetrics';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const Analytics = () => {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Analytics Dashboard</h1>
          <p className="text-muted-foreground">
            Comprehensive insights into your CRM performance and business metrics
          </p>
        </div>

        <AnalyticsOverview />

        <Tabs defaultValue="sales" className="space-y-6">
          <TabsList className="grid w-full lg:w-[400px] grid-cols-3">
            <TabsTrigger value="sales">Sales Analytics</TabsTrigger>
            <TabsTrigger value="customers">Customer Analytics</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
          </TabsList>

          <TabsContent value="sales" className="space-y-6">
            <SalesAnalytics />
          </TabsContent>

          <TabsContent value="customers" className="space-y-6">
            <CustomerAnalytics />
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            <PerformanceMetrics />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default Analytics;
