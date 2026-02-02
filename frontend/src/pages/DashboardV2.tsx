import { useEffect, useState } from 'react';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Calendar, TrendingUp, CheckCircle, Loader2 } from 'lucide-react';
import { RecruiterAnalytics } from '@/components/dashboard/v2/RecruiterAnalytics';
import { ExpertAnalytics } from '@/components/dashboard/v2/ExpertAnalytics';
import { ManagementReports } from '@/components/dashboard/v2/ManagementReports';

interface OverviewStats {
    totalCandidates: number;
    totalInterviews: number;
    completedInterviews: number;
    pendingTasks: number;
    activeCandidates?: number;
}

export default function DashboardV2() {
    const { user, authFetch } = useAuth();
    const [dateBasis, setDateBasis] = useState('interview');
    const [dateMode, setDateMode] = useState<'month' | 'week' | 'date'>('month');

    // Default to current month
    const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [selectedWeek, setSelectedWeek] = useState<string>(new Date().toISOString().slice(0, 10));  // YYYY-MM-DD (start of week)
    const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().slice(0, 10));  // YYYY-MM-DD

    const [overviewStats, setOverviewStats] = useState<OverviewStats | null>(null);
    const [loadingOverview, setLoadingOverview] = useState(true);
    const role = (localStorage.getItem('role') || '').toLowerCase();
    // Role gates for tab visibility. Keep these in sync with backend RBAC and docs.
    // Note: "user" is used for expert accounts in auth payloads.
    const canSeeRecruiterStats = ['admin', 'recruiter', 'manager', 'mlead', 'mam', 'mm'].includes(role);
    const canSeeExpertStats = ['admin', 'user', 'lead', 'am'].includes(role);
    const canSeeManagementReports = ['admin', 'mlead', 'lead', 'mam', 'am', 'mm', 'recruiter', 'user'].includes(role);

    useEffect(() => {
        const fetchOverviewStats = async () => {
            setLoadingOverview(true);
            try {
                let query = `?dateBasis=${dateBasis}`;

                if (dateMode === 'month') {
                    query += `&period=month&startDate=${selectedMonth}-01`; // API handles month logic if start is provided
                } else if (dateMode === 'week') {
                    // Calculate start/end of week logic or let backend handle simple date
                    // Ideally pass exact range or "week" + reference date
                    query += `&period=week&startDate=${selectedWeek}`;
                } else {
                    query += `&period=day&startDate=${selectedDate}`;
                }

                const res = await authFetch(`${API_URL}/api/dashboard/stats/overview${query}`);
                const data = await res.json();
                if (data.success) {
                    setOverviewStats(data.data);
                }
            } catch (error) {
                console.error("Failed to fetch overview stats", error);
            } finally {
                setLoadingOverview(false);
            }
        };

        fetchOverviewStats();
    }, [dateMode, selectedMonth, selectedWeek, selectedDate, dateBasis, authFetch]);

    return (
        <DashboardLayout>
            <div className="container mx-auto p-4 md:p-6 space-y-6 md:space-y-8">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard Overview</h1>
                        <p className="text-sm md:text-base text-muted-foreground">
                            Welcome back, {user?.name || 'User'}
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Select value={dateBasis} onValueChange={setDateBasis}>
                            <SelectTrigger className="w-[150px] md:w-[160px]">
                                <SelectValue placeholder="Date Basis" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="interview">Date of Interview</SelectItem>
                                <SelectItem value="received">Date Received</SelectItem>
                            </SelectContent>
                        </Select>

                        <Select value={dateMode} onValueChange={(v: any) => setDateMode(v)}>
                            <SelectTrigger className="w-[100px]">
                                <SelectValue placeholder="Mode" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="month">Month</SelectItem>
                                <SelectItem value="week">Week</SelectItem>
                                <SelectItem value="date">Date</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* Month Picker: Year + Month Dropdowns */}
                        {dateMode === 'month' && (
                            <div className="flex gap-2">
                                <Select
                                    value={selectedMonth.split('-')[0]}
                                    onValueChange={(y) => setSelectedMonth(`${y}-${selectedMonth.split('-')[1]}`)}
                                >
                                    <SelectTrigger className="w-[100px]">
                                        <SelectValue placeholder="Year" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {[2023, 2024, 2025, 2026].map(y => (
                                            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select
                                    value={selectedMonth.split('-')[1]}
                                    onValueChange={(m) => setSelectedMonth(`${selectedMonth.split('-')[0]}-${m}`)}
                                >
                                    <SelectTrigger className="w-[130px]">
                                        <SelectValue placeholder="Month" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Array.from({ length: 12 }, (_, i) => {
                                            const m = String(i + 1).padStart(2, '0');
                                            const name = new Date(2000, i, 1).toLocaleString('default', { month: 'long' });
                                            return <SelectItem key={m} value={m}>{name}</SelectItem>
                                        })}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* Week Picker: Week Dropdown (Month wise as requested) */}
                        {dateMode === 'week' && (
                            <div className="flex gap-2">
                                {/* First Select Month to filter weeks */}
                                <input
                                    type="month"
                                    className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background w-[140px]"
                                    value={selectedMonth} // Reuse selectedMonth as base for week filtering
                                    onChange={(e) => setSelectedMonth(e.target.value)}
                                />
                                <Select
                                    value={selectedWeek}
                                    onValueChange={setSelectedWeek}
                                >
                                    <SelectTrigger className="w-[200px]">
                                        <SelectValue placeholder="Select Week" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(() => {
                                            const [y, m] = selectedMonth.split('-').map(Number);
                                            const weeks = [];
                                            const firstDay = new Date(y, m - 1, 1);
                                            const lastDay = new Date(y, m, 0);

                                            let current = new Date(firstDay);
                                            // Find first Monday? Or start from 1st?
                                            // Let's iterate days and chunk by week
                                            // Simplest visual: Week 1 (Jan 1 - Jan 7), etc.

                                            while (current <= lastDay) {
                                                const weekStart = new Date(current);
                                                const weekEnd = new Date(current);
                                                weekEnd.setDate(current.getDate() + 6);
                                                // Clamp end
                                                const effectiveEnd = weekEnd > lastDay ? lastDay : weekEnd;

                                                const label = `${weekStart.getDate()} ${weekStart.toLocaleString('default', { month: 'short' })} - ${effectiveEnd.getDate()} ${effectiveEnd.toLocaleString('default', { month: 'short' })}`;
                                                // We pass start date as value
                                                const val = weekStart.toISOString().slice(0, 10);
                                                weeks.push({ val, label });

                                                current.setDate(current.getDate() + 7);
                                            }

                                            return weeks.map((w, i) => (
                                                <SelectItem key={w.val} value={w.val}>Week {i + 1}: {w.label}</SelectItem>
                                            ));
                                        })()}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        {/* Date Picker: Input + Select? User said "tying one we need both typing and select" */}
                        {/* Assuming Input type="date" fulfills typing + picker in modern browsers. */}
                        {dateMode === 'date' && (
                            <input
                                type="date"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 w-[160px]"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                            />
                        )}
                    </div>
                </div>

                <Tabs defaultValue="overview" className="space-y-4">
                    <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 gap-2">
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        {/* Recruiter Stats: admin, recruiter, manager, mlead, mam, mm */}
                        {canSeeRecruiterStats && (
                            <TabsTrigger value="recruiter">Recruiter Stats</TabsTrigger>
                        )}
                        {/* Expert Stats: admin, user (expert), lead, am */}
                        {canSeeExpertStats && (
                            <TabsTrigger value="expert">Expert Stats</TabsTrigger>
                        )}
                        {/* Management Reports: admin, mlead, lead, mam, am, mm, recruiter, user */}
                        {canSeeManagementReports && (
                            <TabsTrigger value="management">Management Reports</TabsTrigger>
                        )}
                    </TabsList>

                    <TabsContent value="overview" className="space-y-4">
                        {loadingOverview ? (
                            <div className="flex justify-center p-8">
                                <Loader2 className="h-8 w-8 animate-spin" />
                            </div>
                        ) : (
                            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                                <Card>
                                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                        <CardTitle className="text-sm font-medium">Total Candidates</CardTitle>
                                        <Users className="h-4 w-4 text-muted-foreground" />
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold">{overviewStats?.totalCandidates || 0} (Act: {overviewStats?.activeCandidates || 0})</div>
                                        <p className="text-xs text-muted-foreground">Active in system</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                        <CardTitle className="text-sm font-medium">Total Interviews</CardTitle>
                                        <Calendar className="h-4 w-4 text-muted-foreground" />
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold">{overviewStats?.totalInterviews || 0}</div>
                                        <p className="text-xs text-muted-foreground">In selected range</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                        <CardTitle className="text-sm font-medium">Completed</CardTitle>
                                        <CheckCircle className="h-4 w-4 text-muted-foreground" />
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold">{overviewStats?.completedInterviews || 0}</div>
                                        <p className="text-xs text-muted-foreground">Successfully done</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                        <CardTitle className="text-sm font-medium">Pending Tasks</CardTitle>
                                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                                    </CardHeader>
                                    <CardContent>
                                        <div className="text-2xl font-bold">{overviewStats?.pendingTasks || 0}</div>
                                        <p className="text-xs text-muted-foreground">Awaiting action</p>
                                    </CardContent>
                                </Card>
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="recruiter" className="space-y-4">
                        <RecruiterAnalytics
                            period={dateMode}
                            dateBasis={dateBasis}
                            startDate={dateMode === 'month' ? `${selectedMonth}-01` : (dateMode === 'week' ? selectedWeek : selectedDate)}
                        />
                    </TabsContent>

                    <TabsContent value="expert" className="space-y-4">
                        <ExpertAnalytics
                            period={dateMode}
                            dateBasis={dateBasis}
                            startDate={dateMode === 'month' ? `${selectedMonth}-01` : (dateMode === 'week' ? selectedWeek : selectedDate)}
                        />
                    </TabsContent>

                    <TabsContent value="management" className="space-y-4">
                        <ManagementReports />
                    </TabsContent>
                </Tabs>
            </div>
        </DashboardLayout>
    );
}
