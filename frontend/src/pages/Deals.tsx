
import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Search, Plus, Filter, DollarSign, TrendingUp, Users, Calendar } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Deal {
  id: string;
  title: string;
  company: string;
  value: number;
  stage: 'prospecting' | 'qualification' | 'proposal' | 'negotiation' | 'closed-won' | 'closed-lost';
  probability: number;
  closeDate: string;
  owner: string;
  avatar: string;
}

const Deals = () => {
  const [searchTerm, setSearchTerm] = useState('');

  const deals: Deal[] = [
    {
      id: '1',
      title: 'Enterprise Software License',
      company: 'TechCorp Inc.',
      value: 150000,
      stage: 'negotiation',
      probability: 80,
      closeDate: '2024-01-15',
      owner: 'John Smith',
      avatar: '/placeholder.svg'
    },
    {
      id: '2',
      title: 'Marketing Automation Setup',
      company: 'StartupXYZ',
      value: 75000,
      stage: 'proposal',
      probability: 60,
      closeDate: '2024-01-20',
      owner: 'Sarah Johnson',
      avatar: '/placeholder.svg'
    },
    {
      id: '3',
      title: 'Cloud Migration Project',
      company: 'BigCorp Ltd.',
      value: 200000,
      stage: 'qualification',
      probability: 40,
      closeDate: '2024-02-01',
      owner: 'Mike Wilson',
      avatar: '/placeholder.svg'
    }
  ];

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'prospecting': return 'bg-gray-100 text-gray-800';
      case 'qualification': return 'bg-blue-100 text-blue-800';
      case 'proposal': return 'bg-yellow-100 text-yellow-800';
      case 'negotiation': return 'bg-orange-100 text-orange-800';
      case 'closed-won': return 'bg-green-100 text-green-800';
      case 'closed-lost': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStageLabel = (stage: string) => {
    return stage.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const filteredDeals = deals.filter(deal =>
    deal.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    deal.company.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalValue = deals.reduce((sum, deal) => sum + deal.value, 0);
  const avgProbability = deals.reduce((sum, deal) => sum + deal.probability, 0) / deals.length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Deals</h1>
            <p className="text-muted-foreground">Manage your sales pipeline and opportunities</p>
          </div>
          <Button asChild>
            <Link to="/deal-details">
              <Plus className="mr-2 h-4 w-4" />
              New Deal
            </Link>
          </Button>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Pipeline Value</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${totalValue.toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">+12% from last month</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Deals</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{deals.length}</div>
              <p className="text-xs text-muted-foreground">+3 new this week</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg. Probability</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{avgProbability.toFixed(0)}%</div>
              <p className="text-xs text-muted-foreground">+5% from last month</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">This Month</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">5</div>
              <p className="text-xs text-muted-foreground">deals closing</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters and Search */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>All Deals</CardTitle>
                <CardDescription>Track and manage your sales opportunities</CardDescription>
              </div>
              <div className="flex space-x-2">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search deals..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 w-64"
                  />
                </div>
                <Button variant="outline">
                  <Filter className="mr-2 h-4 w-4" />
                  Filter
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {filteredDeals.map((deal) => (
                <div key={deal.id} className="flex items-center space-x-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{deal.title}</h3>
                      <div className="text-lg font-bold">${deal.value.toLocaleString()}</div>
                    </div>
                    <p className="text-sm text-muted-foreground">{deal.company}</p>
                    <div className="flex items-center space-x-4 mt-2">
                      <Badge className={getStageColor(deal.stage)}>
                        {getStageLabel(deal.stage)}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {deal.probability}% probability
                      </span>
                      <span className="text-sm text-muted-foreground">
                        Close: {new Date(deal.closeDate).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={deal.avatar} alt={deal.owner} />
                      <AvatarFallback>{deal.owner.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                    </Avatar>
                    <span className="text-sm text-muted-foreground">{deal.owner}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default Deals;
