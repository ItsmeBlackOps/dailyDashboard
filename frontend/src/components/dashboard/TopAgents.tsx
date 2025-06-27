import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

interface Agent {
  id: string;
  name: string;
  image?: string;
  initials: string;
  deals: number;
  target: number;
  revenue: number;
}

const agents: Agent[] = [
  {
    id: '1',
    name: 'Sarah Johnson',
    initials: 'SJ',
    deals: 24,
    target: 20,
    revenue: 125400,
  },
  {
    id: '2',
    name: 'Michael Chang',
    initials: 'MC',
    deals: 19,
    target: 20,
    revenue: 98500,
  },
  {
    id: '3',
    name: 'Jessica Lee',
    initials: 'JL',
    deals: 18,
    target: 20,
    revenue: 95200,
  },
  {
    id: '4',
    name: 'Robert Garcia',
    initials: 'RG',
    deals: 17,
    target: 20,
    revenue: 86700,
  },
  {
    id: '5',
    name: 'Joh Deo',
    initials: 'JD',
    deals: 22,
    target: 28,
    revenue: 90000,
  },
];

export function TopAgents() {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <Card className="dashboard-card">
      <CardHeader className=" mb-6 p-0">
        <CardTitle className="text-lg font-medium">Top Performing Agents</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pt-4">
        <div className="space-y-4">
          {agents.map((agent) => {
            const progressPercentage = (agent.deals / agent.target) * 100;
            return (
              <div key={agent.id} className="flex items-center gap-4">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={agent.image} alt={agent.name} />
                  <AvatarFallback>{agent.initials}</AvatarFallback>
                </Avatar>

                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <p className="text-sm font-medium truncate">{agent.name}</p>
                    <span className="text-sm font-medium text-muted-foreground">{formatCurrency(agent.revenue)}</span>
                  </div>

                  <div className="flex justify-between items-center">
                    <div className="flex-1 mr-4">
                      <Progress value={progressPercentage} className="h-2" />
                    </div>
                    <div className="flex items-center">
                      <Badge variant="outline" className="text-xs">
                        {agent.deals}/{agent.target} deals
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
