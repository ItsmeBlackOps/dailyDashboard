import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RecruiterAnalytics } from '@/components/dashboard/v2/RecruiterAnalytics';
import { ExpertAnalytics } from '@/components/dashboard/v2/ExpertAnalytics';
import { ManagementReports } from '@/components/dashboard/v2/ManagementReports';

export default function DashboardV2() {
    const { user } = useAuth();
    const [period, setPeriod] = useStateString('month');
    const [dateBasis, setDateBasis] = useStateString('interview'); // 'interview' or 'received'
    const role = (localStorage.getItem('role') || '').toLowerCase();

    return (
        <div className="container mx-auto p-6 space-y-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Dashboard Overview</h1>
                    <p className="text-muted-foreground">
                        Welcome back, {user?.name || 'User'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Select value={dateBasis} onValueChange={setDateBasis}>
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Date Basis" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="interview">Date of Interview</SelectItem>
                            <SelectItem value="received">Date Received</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={period} onValueChange={setPeriod}>
                        <SelectTrigger className="w-[160px]">
                            <SelectValue placeholder="Select period" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="week">This Week</SelectItem>
                            <SelectItem value="month">This Month</SelectItem>
                            <SelectItem value="year">This Year</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline">Export Report</Button>
                </div>
            </div>

            <Tabs defaultValue="overview" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    {['admin', 'recruiter', 'manager', 'mlead', 'lead', 'mam', 'am', 'mm'].includes(role) && (
                        <TabsTrigger value="recruiter">Recruiter Stats</TabsTrigger>
                    )}
                    {['admin', 'user', 'expert', 'manager', 'mlead', 'lead', 'mam', 'am', 'mm'].includes(role) && (
                        <TabsTrigger value="expert">Expert Stats</TabsTrigger>
                    )}
                    {['admin', 'manager', 'mlead', 'lead', 'mam', 'am', 'mm'].includes(role) && (
                        <TabsTrigger value="management">Management Reports</TabsTrigger>
                    )}
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <div className="p-6 bg-card rounded-xl border shadow-sm">
                            <h3 className="font-semibold text-sm text-muted-foreground">Total Candidates (Month)</h3>
                            <div className="text-2xl font-bold mt-2">--</div>
                        </div>
                        <div className="p-6 bg-card rounded-xl border shadow-sm">
                            <h3 className="font-semibold text-sm text-muted-foreground">Interviews Scheduled</h3>
                            <div className="text-2xl font-bold mt-2">--</div>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="recruiter" className="space-y-4">
                    <RecruiterAnalytics period={period} dateBasis={dateBasis} />
                </TabsContent>

                <TabsContent value="expert" className="space-y-4">
                    <ExpertAnalytics period={period} />
                </TabsContent>

                <TabsContent value="management" className="space-y-4">
                    <ManagementReports />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function useStateString(initial: string) {
    const [state, setState] = useState(initial);
    return [state, setState] as const;
}
