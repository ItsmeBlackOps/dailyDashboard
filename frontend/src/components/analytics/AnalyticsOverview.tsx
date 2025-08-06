
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Users, DollarSign, Target, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricCardProps {
  title: string;
  value: string;
  change: number;
  changeLabel: string;
  icon: React.ReactNode;
}

function MetricCard({ title, value, change, changeLabel, icon }: MetricCardProps) {
  const isPositive = change > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="h-4 w-4 text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">
          <span className={cn(
            'inline-flex items-center',
            isPositive ? 'text-green-600' : 'text-red-600'
          )}>
            {isPositive ? <TrendingUp className="mr-1 h-3 w-3" /> : <TrendingDown className="mr-1 h-3 w-3" />}
            {Math.abs(change)}%
          </span>
          {' '}{changeLabel}
        </p>
      </CardContent>
    </Card>
  );
}

export function AnalyticsOverview() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        title="Total Revenue"
        value="$54,231"
        change={12.5}
        changeLabel="from last month"
        icon={<DollarSign className="h-4 w-4" />}
      />
      <MetricCard
        title="Active Customers"
        value="2,350"
        change={8.2}
        changeLabel="from last month"
        icon={<Users className="h-4 w-4" />}
      />
      <MetricCard
        title="Conversion Rate"
        value="24.5%"
        change={-2.1}
        changeLabel="from last month"
        icon={<Target className="h-4 w-4" />}
      />
      <MetricCard
        title="Active Deals"
        value="184"
        change={15.3}
        changeLabel="from last month"
        icon={<Activity className="h-4 w-4" />}
      />
    </div>
  );
}
