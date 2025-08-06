
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BarChart3, FileText, Download, Plus, TrendingUp, Users, DollarSign, Target } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Report {
  id: string;
  name: string;
  type: 'sales' | 'leads' | 'pipeline' | 'activity';
  description: string;
  lastRun: string;
  frequency: string;
  status: 'active' | 'scheduled' | 'draft';
}

const Reports = () => {
  const reports: Report[] = [
    {
      id: '1',
      name: 'Monthly Sales Report',
      type: 'sales',
      description: 'Comprehensive sales performance analysis',
      lastRun: '2024-01-10',
      frequency: 'Monthly',
      status: 'active'
    },
    {
      id: '2',
      name: 'Lead Generation Analysis',
      type: 'leads',
      description: 'Lead sources and conversion tracking',
      lastRun: '2024-01-08',
      frequency: 'Weekly',
      status: 'active'
    },
    {
      id: '3',
      name: 'Pipeline Health Check',
      type: 'pipeline',
      description: 'Deal progression and pipeline metrics',
      lastRun: '2024-01-05',
      frequency: 'Bi-weekly',
      status: 'scheduled'
    },
    {
      id: '4',
      name: 'Team Activity Summary',
      type: 'activity',
      description: 'Team performance and activity metrics',
      lastRun: 'Never',
      frequency: 'Daily',
      status: 'draft'
    }
  ];

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'sales': return DollarSign;
      case 'leads': return Target;
      case 'pipeline': return TrendingUp;
      case 'activity': return Users;
      default: return FileText;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'sales': return 'bg-green-100 text-green-800';
      case 'leads': return 'bg-blue-100 text-blue-800';
      case 'pipeline': return 'bg-orange-100 text-orange-800';
      case 'activity': return 'bg-purple-100 text-purple-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'scheduled': return 'bg-yellow-100 text-yellow-800';
      case 'draft': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
            <p className="text-muted-foreground">Generate and manage your business reports</p>
          </div>
          <Button asChild>
            <Link to="/report-details">
              <Plus className="mr-2 h-4 w-4" />
              New Report
            </Link>
          </Button>
        </div>

        {/* Quick Stats */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Reports</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{reports.length}</div>
              <p className="text-xs text-muted-foreground">Active reports</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Scheduled</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">3</div>
              <p className="text-xs text-muted-foreground">Auto-generated</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">This Month</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">12</div>
              <p className="text-xs text-muted-foreground">Reports generated</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Downloads</CardTitle>
              <Download className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">48</div>
              <p className="text-xs text-muted-foreground">This month</p>
            </CardContent>
          </Card>
        </div>

        {/* Reports List */}
        <Card>
          <CardHeader>
            <CardTitle>All Reports</CardTitle>
            <CardDescription>Manage your business intelligence reports</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {reports.map((report) => {
                const IconComponent = getTypeIcon(report.type);
                return (
                  <div key={report.id} className="flex items-center space-x-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex-shrink-0">
                      <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center">
                        <IconComponent className="h-6 w-6 text-muted-foreground" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold">{report.name}</h3>
                        <div className="flex space-x-2">
                          <Badge className={getTypeColor(report.type)}>
                            {report.type.charAt(0).toUpperCase() + report.type.slice(1)}
                          </Badge>
                          <Badge className={getStatusColor(report.status)}>
                            {report.status.charAt(0).toUpperCase() + report.status.slice(1)}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{report.description}</p>
                      <div className="flex items-center space-x-4 mt-2 text-sm text-muted-foreground">
                        <span>Frequency: {report.frequency}</span>
                        <span>Last run: {report.lastRun === 'Never' ? 'Never' : new Date(report.lastRun).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <Button variant="outline" size="sm">
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link to="/report-details">
                          <FileText className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default Reports;
