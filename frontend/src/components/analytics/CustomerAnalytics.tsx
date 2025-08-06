
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, AreaChart, Area, BarChart, Bar, ResponsiveContainer } from 'recharts';
import { Badge } from '@/components/ui/badge';

const customerGrowthData = [
  { month: 'Jan', newCustomers: 145, totalCustomers: 1250 },
  { month: 'Feb', newCustomers: 167, totalCustomers: 1417 },
  { month: 'Mar', newCustomers: 134, totalCustomers: 1551 },
  { month: 'Apr', newCustomers: 189, totalCustomers: 1740 },
  { month: 'May', newCustomers: 201, totalCustomers: 1941 },
  { month: 'Jun', newCustomers: 178, totalCustomers: 2119 },
];

const customerSegmentData = [
  { segment: 'Enterprise', customers: 45, revenue: 450000, avgDeal: 10000 },
  { segment: 'Mid-Market', customers: 123, revenue: 369000, avgDeal: 3000 },
  { segment: 'Small Business', customers: 567, revenue: 283500, avgDeal: 500 },
  { segment: 'Startup', customers: 234, revenue: 117000, avgDeal: 500 },
];

const retentionData = [
  { month: 'Jan', retention: 94, churn: 6 },
  { month: 'Feb', retention: 96, churn: 4 },
  { month: 'Mar', retention: 93, churn: 7 },
  { month: 'Apr', retention: 97, churn: 3 },
  { month: 'May', retention: 95, churn: 5 },
  { month: 'Jun', retention: 98, churn: 2 },
];

const chartConfig = {
  newCustomers: {
    label: 'New Customers',
    color: 'hsl(var(--primary))',
  },
  totalCustomers: {
    label: 'Total Customers',
    color: 'hsl(var(--secondary))',
  },
  customers: {
    label: 'Customers',
    color: 'hsl(var(--primary))',
  },
  retention: {
    label: 'Retention Rate',
    color: 'hsl(var(--primary))',
  },
  churn: {
    label: 'Churn Rate',
    color: 'hsl(var(--destructive))',
  },
};

export function CustomerAnalytics() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Customer Growth</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <AreaChart data={customerGrowthData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area 
                  type="monotone" 
                  dataKey="newCustomers" 
                  stackId="1" 
                  stroke="var(--color-newCustomers)" 
                  fill="var(--color-newCustomers)" 
                  fillOpacity={0.6}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customer Retention & Churn</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <LineChart data={retentionData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                <ChartTooltip 
                  content={<ChartTooltipContent />}
                  formatter={(value) => [`${value}%`, undefined]}
                />
                <Line 
                  type="monotone" 
                  dataKey="retention" 
                  stroke="var(--color-retention)" 
                  strokeWidth={3}
                  dot={{ r: 4 }}
                />
                <Line 
                  type="monotone" 
                  dataKey="churn" 
                  stroke="var(--color-churn)" 
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Customer Segments Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {customerSegmentData.map((segment) => (
              <div 
                key={segment.segment} 
                className="flex items-center justify-between p-4 border rounded-lg"
              >
                <div className="flex items-center space-x-4">
                  <div>
                    <h3 className="font-medium">{segment.segment}</h3>
                    <p className="text-sm text-muted-foreground">
                      {segment.customers} customers
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-6">
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Revenue</p>
                    <p className="font-medium">${segment.revenue.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Avg Deal</p>
                    <p className="font-medium">${segment.avgDeal.toLocaleString()}</p>
                  </div>
                  <Badge variant="outline">
                    {((segment.revenue / segment.customers) / 1000).toFixed(1)}k ARV
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
