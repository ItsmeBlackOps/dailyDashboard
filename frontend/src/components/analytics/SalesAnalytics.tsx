
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

const monthlyRevenueData = [
  { month: 'Jan', revenue: 48000, target: 45000 },
  { month: 'Feb', revenue: 52000, target: 48000 },
  { month: 'Mar', revenue: 47000, target: 50000 },
  { month: 'Apr', revenue: 58000, target: 52000 },
  { month: 'May', revenue: 62000, target: 55000 },
  { month: 'Jun', revenue: 55000, target: 58000 },
];

const salesByStageData = [
  { stage: 'Prospecting', deals: 45, value: 180000 },
  { stage: 'Qualification', deals: 32, value: 256000 },
  { stage: 'Proposal', deals: 18, value: 324000 },
  { stage: 'Negotiation', deals: 12, value: 240000 },
  { stage: 'Closed Won', deals: 8, value: 160000 },
];

const salesByProductData = [
  { name: 'Basic Plan', value: 35, color: '#3b82f6' },
  { name: 'Pro Plan', value: 45, color: '#10b981' },
  { name: 'Enterprise', value: 20, color: '#f59e0b' },
];

const chartConfig = {
  revenue: {
    label: 'Revenue',
    color: 'hsl(var(--primary))',
  },
  target: {
    label: 'Target',
    color: 'hsl(var(--muted-foreground))',
  },
  deals: {
    label: 'Deals',
    color: 'hsl(var(--primary))',
  },
  value: {
    label: 'Value',
    color: 'hsl(var(--secondary))',
  },
};

export function SalesAnalytics() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Monthly Revenue vs Target</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[300px]">
            <LineChart data={monthlyRevenueData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(value) => `$${value / 1000}k`} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line 
                type="monotone" 
                dataKey="revenue" 
                stroke="var(--color-revenue)" 
                strokeWidth={3} 
                dot={{ r: 4 }}
              />
              <Line 
                type="monotone" 
                dataKey="target" 
                stroke="var(--color-target)" 
                strokeWidth={2} 
                strokeDasharray="5 5"
                dot={{ r: 3 }}
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sales Pipeline by Stage</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[300px]">
            <BarChart data={salesByStageData} layout="horizontal">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={(value) => `$${value / 1000}k`} />
              <YAxis dataKey="stage" type="category" width={80} />
              <ChartTooltip 
                content={<ChartTooltipContent />}
                formatter={(value, name) => [
                  name === 'value' ? `$${Number(value).toLocaleString()}` : value,
                  name === 'value' ? 'Pipeline Value' : 'Number of Deals'
                ]}
              />
              <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sales by Product</CardTitle>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[300px]">
            <PieChart>
              <Pie
                data={salesByProductData}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
                dataKey="value"
              >
                {salesByProductData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <ChartTooltip 
                content={<ChartTooltipContent />}
                formatter={(value) => [`${value}%`, 'Sales Share']}
              />
            </PieChart>
          </ChartContainer>
          <div className="mt-4 space-y-2">
            {salesByProductData.map((item) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div 
                    className="h-3 w-3 rounded-full" 
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-sm">{item.name}</span>
                </div>
                <span className="text-sm font-medium">{item.value}%</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
