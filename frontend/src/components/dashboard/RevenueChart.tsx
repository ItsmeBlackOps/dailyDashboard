import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Badge } from '@/components/ui/badge';

const data = [
  {
    month: 'Jan',
    revenue: 38000,
    target: 35000,
  },
  {
    month: 'Feb',
    revenue: 42000,
    target: 38000,
  },
  {
    month: 'Mar',
    revenue: 45000,
    target: 40000,
  },
  {
    month: 'Apr',
    revenue: 48000,
    target: 42000,
  },
  {
    month: 'May',
    revenue: 51000,
    target: 45000,
  },
  {
    month: 'Jun',
    revenue: 49000,
    target: 48000,
  },
  {
    month: 'Jul',
    revenue: 54000,
    target: 50000,
  },
];

export function RevenueChart() {
  // Calculate current month's revenue change percentage
  const currentMonth = data[data.length - 1];
  const previousMonth = data[data.length - 2];
  const changePercentage = (((currentMonth.revenue - previousMonth.revenue) / previousMonth.revenue) * 100).toFixed(1);
  const isPositive = parseFloat(changePercentage) >= 0;

  return (
    <Card className="dashboard-card">
      <CardHeader className="flex flex-row items-center justify-between mb-6 p-0">
        <CardTitle className="text-lg font-medium">Revenue This Year</CardTitle>
        <Badge variant="outline" className={isPositive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}>
          {isPositive ? '+' : ''}
          {changePercentage}% from last month
        </Badge>
      </CardHeader>
      <CardContent className="px-0 pt-4">
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data}
              margin={{
                top: 5,
                right: 0,
                left: -24,
                bottom: 5,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value / 1000}k`} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  borderColor: 'hsl(var(--border))',
                  borderRadius: 'var(--radius)',
                }}
                formatter={(value: number) => [`$${value.toLocaleString()}`, undefined]}
                labelFormatter={(label) => `${label}`}
              />
              <Line type="monotone" dataKey="target" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 5" dot={false} activeDot={{ r: 4 }} strokeWidth={2} />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="hsl(var(--primary))"
                strokeWidth={3}
                dot={{
                  r: 4,
                  fill: 'hsl(var(--primary))',
                  stroke: 'hsl(var(--card))',
                  strokeWidth: 2,
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
