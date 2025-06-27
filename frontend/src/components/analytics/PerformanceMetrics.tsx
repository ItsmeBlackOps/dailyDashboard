
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, ResponsiveContainer } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const teamPerformanceData = [
  { agent: 'Alice Johnson', deals: 23, revenue: 145000, target: 120000, conversion: 28 },
  { agent: 'Bob Smith', deals: 19, revenue: 98000, target: 100000, conversion: 22 },
  { agent: 'Carol Davis', deals: 31, revenue: 187000, target: 150000, conversion: 35 },
  { agent: 'David Wilson', deals: 15, revenue: 76000, target: 80000, conversion: 18 },
  { agent: 'Eva Brown', deals: 27, revenue: 134000, target: 130000, conversion: 31 },
];

const activityData = [
  { week: 'Week 1', calls: 145, emails: 289, meetings: 23 },
  { week: 'Week 2', calls: 167, emails: 312, meetings: 28 },
  { week: 'Week 3', calls: 134, emails: 256, meetings: 19 },
  { week: 'Week 4', calls: 189, emails: 378, meetings: 34 },
];

const conversionFunnelData = [
  { stage: 'Leads', count: 1250, percentage: 100 },
  { stage: 'Qualified', count: 750, percentage: 60 },
  { stage: 'Proposal', count: 300, percentage: 24 },
  { stage: 'Negotiation', count: 150, percentage: 12 },
  { stage: 'Closed Won', count: 75, percentage: 6 },
];

const chartConfig = {
  deals: {
    label: 'Deals',
    color: 'hsl(var(--primary))',
  },
  revenue: {
    label: 'Revenue',
    color: 'hsl(var(--secondary))',
  },
  calls: {
    label: 'Calls',
    color: 'hsl(var(--primary))',
  },
  emails: {
    label: 'Emails',
    color: 'hsl(var(--secondary))',
  },
  meetings: {
    label: 'Meetings',
    color: 'hsl(var(--accent))',
  },
};

export function PerformanceMetrics() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Team Activity Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <BarChart data={activityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="week" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="calls" fill="var(--color-calls)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="emails" fill="var(--color-emails)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="meetings" fill="var(--color-meetings)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conversion Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {conversionFunnelData.map((stage, index) => (
                <div key={stage.stage} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">{stage.stage}</span>
                    <span className="text-sm text-muted-foreground">
                      {stage.count} ({stage.percentage}%)
                    </span>
                  </div>
                  <Progress 
                    value={stage.percentage} 
                    className="h-2"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team Performance Leaderboard</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {teamPerformanceData.map((agent, index) => {
              const targetAchievement = (agent.revenue / agent.target) * 100;
              const isAboveTarget = targetAchievement >= 100;
              
              return (
                <div 
                  key={agent.agent} 
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg font-bold text-muted-foreground">
                        #{index + 1}
                      </span>
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={`/avatars/${agent.agent.toLowerCase().replace(' ', '-')}.jpg`} />
                        <AvatarFallback>
                          {agent.agent.split(' ').map(n => n[0]).join('')}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <div>
                      <h3 className="font-medium">{agent.agent}</h3>
                      <p className="text-sm text-muted-foreground">
                        {agent.deals} deals • {agent.conversion}% conversion
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-6">
                    <div className="text-right">
                      <p className="font-medium">${agent.revenue.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">
                        Target: ${agent.target.toLocaleString()}
                      </p>
                    </div>
                    <Badge 
                      variant={isAboveTarget ? "default" : "secondary"}
                      className={isAboveTarget ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300" : ""}
                    >
                      {targetAchievement.toFixed(0)}%
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
