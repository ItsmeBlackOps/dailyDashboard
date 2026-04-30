import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Calendar, TrendingUp, CheckCircle, Loader2, Filter } from 'lucide-react';
import { RecruiterAnalytics } from '@/components/dashboard/v2/RecruiterAnalytics';
import { ExpertAnalytics } from '@/components/dashboard/v2/ExpertAnalytics';
import { ManagementReports } from '@/components/dashboard/v2/ManagementReports';
import { CandidateGroupsWidget } from '@/components/dashboard/v2/CandidateGroupsWidget';
import POTab from '@/components/profile-hub/POTab';

interface OverviewStats {
    totalCandidates: number;
    totalInterviews: number;
    completedInterviews: number;
    pendingTasks: number;
    activeCandidates?: number;
}

export default function DashboardV2() {
    const { user, authFetch } = useAuth();
    // Filters persist in URL search params so refreshing / switching tabs /
    // sharing a link preserves the selection.
    const initialParams = (() => {
        try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); }
    })();
    const todayMonth = new Date().toISOString().slice(0, 7);
    const todayDate  = new Date().toISOString().slice(0, 10);
    const [dateBasis,    setDateBasis]    = useState<string>(initialParams.get('dateBasis') || 'interview');
    const [dateMode,     setDateMode]     = useState<'month' | 'week' | 'date'>(
        (initialParams.get('period') as 'month' | 'week' | 'date') || 'month'
    );
    const [selectedMonth, setSelectedMonth] = useState<string>(initialParams.get('month') || todayMonth);
    const [selectedWeek,  setSelectedWeek]  = useState<string>(initialParams.get('week')  || todayDate);
    const [selectedDate,  setSelectedDate]  = useState<string>(initialParams.get('date')  || todayDate);
    const [overviewStats, setOverviewStats] = useState<OverviewStats | null>(null);
    const [loadingOverview, setLoadingOverview] = useState(true);

    const [searchParams, setSearchParams] = useSearchParams();

    const role = (localStorage.getItem('role') || '').toLowerCase();
    const canSeeRecruiterStats  = ['admin', 'recruiter', 'manager', 'mlead', 'mam', 'mm'].includes(role);
    const canSeeExpertStats     = ['admin', 'user', 'lead', 'am'].includes(role);
    const canSeeManagementReports = ['admin', 'mlead', 'lead', 'mam', 'am', 'mm', 'recruiter', 'user'].includes(role);

    const ALWAYS_TABS = ['overview', 'candidates', 'po'];
    const ROLE_TABS = [
      canSeeRecruiterStats    ? 'recruiter'   : null,
      canSeeExpertStats       ? 'expert'      : null,
      canSeeManagementReports ? 'management'  : null,
    ].filter(Boolean) as string[];
    const VALID_TABS = [...ALWAYS_TABS, ...ROLE_TABS];
    const raw = searchParams.get('tab');
    const activeTab = raw && VALID_TABS.includes(raw) ? raw : 'overview';
    const handleTabChange = (value: string) =>
      setSearchParams(prev => { prev.set('tab', value); return prev; }, { replace: true });
    const canSeePO              = true; // all authenticated roles — scoped by backend

    const startDate = dateMode === 'month' ? `${selectedMonth}-01`
                    : dateMode === 'week'  ? selectedWeek
                    : selectedDate;

    // Mirror filters into the URL so the page survives refresh + share.
    useEffect(() => {
        setSearchParams((prev) => {
            prev.set('dateBasis', dateBasis);
            prev.set('period', dateMode);
            if (dateMode === 'month') prev.set('month', selectedMonth);
            else prev.delete('month');
            if (dateMode === 'week') prev.set('week', selectedWeek);
            else prev.delete('week');
            if (dateMode === 'date') prev.set('date', selectedDate);
            else prev.delete('date');
            return prev;
        }, { replace: true });
    }, [dateBasis, dateMode, selectedMonth, selectedWeek, selectedDate, setSearchParams]);

    useEffect(() => {
        const fetch = async () => {
            setLoadingOverview(true);
            try {
                const q = `?dateBasis=${dateBasis}&period=${dateMode}&startDate=${startDate}`;
                const res = await authFetch(`${API_URL}/api/dashboard/stats/overview${q}`);
                const data = await res.json();
                if (data.success) setOverviewStats(data.data);
            } catch { /* silently fail */ }
            finally { setLoadingOverview(false); }
        };
        fetch();
    }, [dateMode, selectedMonth, selectedWeek, selectedDate, dateBasis, authFetch]);

    // Helper: weeks in selected month
    const weeksInMonth = (() => {
        const [y, m] = selectedMonth.split('-').map(Number);
        const weeks: { val: string; label: string }[] = [];
        let cur = new Date(y, m - 1, 1);
        const last = new Date(y, m, 0);
        while (cur <= last) {
            const start = new Date(cur);
            const end = new Date(cur); end.setDate(cur.getDate() + 6);
            const eff = end > last ? last : end;
            weeks.push({
                val: start.toISOString().slice(0, 10),
                label: `${start.getDate()} ${start.toLocaleString('default', { month: 'short' })} – ${eff.getDate()} ${eff.toLocaleString('default', { month: 'short' })}`,
            });
            cur.setDate(cur.getDate() + 7);
        }
        return weeks;
    })();

    return (
        <DashboardLayout>
            <div className="flex flex-col h-full">
                {/* ── Header ── */}
                <div className="px-4 md:px-6 pt-4 md:pt-6 pb-3 border-b">
                    <h1 className="text-xl md:text-2xl font-bold tracking-tight">Dashboard Overview</h1>
                    <p className="text-sm text-muted-foreground">
                        Welcome back, {user?.displayName || user?.email?.split('@')[0] || 'User'}
                    </p>
                </div>

                {/* ── Sticky Date Filter Bar ── */}
                <div className="sticky top-0 z-10 bg-background border-b px-4 md:px-6 py-2 flex flex-wrap items-center gap-2">
                    <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

                    <Select value={dateBasis} onValueChange={setDateBasis}>
                        <SelectTrigger className="h-8 w-[150px] text-xs">
                            <SelectValue placeholder="Date Basis" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="interview">Date of Interview</SelectItem>
                            <SelectItem value="received">Date Received</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={dateMode} onValueChange={(v: any) => setDateMode(v)}>
                        <SelectTrigger className="h-8 w-[90px] text-xs">
                            <SelectValue placeholder="Mode" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="month">Month</SelectItem>
                            <SelectItem value="week">Week</SelectItem>
                            <SelectItem value="date">Date</SelectItem>
                        </SelectContent>
                    </Select>

                    {dateMode === 'month' && (
                        <>
                            <Select value={selectedMonth.split('-')[0]}
                                onValueChange={y => setSelectedMonth(`${y}-${selectedMonth.split('-')[1]}`)}>
                                <SelectTrigger className="h-8 w-[90px] text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {[2023, 2024, 2025, 2026].map(y => (
                                        <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={selectedMonth.split('-')[1]}
                                onValueChange={m => setSelectedMonth(`${selectedMonth.split('-')[0]}-${m}`)}>
                                <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {Array.from({ length: 12 }, (_, i) => {
                                        const m = String(i + 1).padStart(2, '0');
                                        return <SelectItem key={m} value={m}>
                                            {new Date(2000, i, 1).toLocaleString('default', { month: 'long' })}
                                        </SelectItem>;
                                    })}
                                </SelectContent>
                            </Select>
                        </>
                    )}

                    {dateMode === 'week' && (
                        <>
                            <input type="month" value={selectedMonth}
                                onChange={e => setSelectedMonth(e.target.value)}
                                className="h-8 rounded-md border border-input bg-background px-2 text-xs w-[130px]" />
                            <Select value={selectedWeek} onValueChange={setSelectedWeek}>
                                <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue placeholder="Week" /></SelectTrigger>
                                <SelectContent>
                                    {weeksInMonth.map((w, i) => (
                                        <SelectItem key={w.val} value={w.val}>Week {i + 1}: {w.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </>
                    )}

                    {dateMode === 'date' && (
                        <input type="date" value={selectedDate}
                            onChange={e => setSelectedDate(e.target.value)}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs w-[140px]" />
                    )}
                </div>

                {/* ── Tabs ── */}
                <div className="flex-1 overflow-auto px-4 md:px-6 py-4">
                    <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
                        <div className="overflow-x-auto pb-1">
                            <TabsList className="flex w-max gap-1 h-auto">
                                <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
                                <TabsTrigger value="candidates" className="text-xs">My Candidates</TabsTrigger>
                                <TabsTrigger value="po" className="text-xs">PO Candidates</TabsTrigger>
                                {canSeeRecruiterStats    && <TabsTrigger value="recruiter"   className="text-xs">Recruiter Stats</TabsTrigger>}
                                {canSeeExpertStats       && <TabsTrigger value="expert"     className="text-xs">Expert Stats</TabsTrigger>}
                                {canSeeManagementReports && <TabsTrigger value="management" className="text-xs">Management Reports</TabsTrigger>}
                            </TabsList>
                        </div>

                        {/* Overview tab — KPIs + At-Risk inline */}
                        <TabsContent value="overview" className="space-y-6 mt-0">
                            {loadingOverview ? (
                                <div className="flex justify-center p-8">
                                    <Loader2 className="h-8 w-8 animate-spin" />
                                </div>
                            ) : (
                                <div className="grid gap-4 grid-cols-2 sm:grid-cols-2 lg:grid-cols-4">
                                    <Card>
                                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                            <CardTitle className="text-sm font-medium">Total Candidates</CardTitle>
                                            <Users className="h-4 w-4 text-muted-foreground" />
                                        </CardHeader>
                                        <CardContent>
                                            <div className="text-2xl font-bold">{overviewStats?.totalCandidates || 0}</div>
                                            <p className="text-xs text-muted-foreground">Active: {overviewStats?.activeCandidates || 0}</p>
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

                            {/* At-Risk candidates — always visible in Overview for eligible roles */}
                            {canSeeManagementReports && (
                                <div>
                                    <h2 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">At-Risk Candidates</h2>
                                    <ManagementReports />
                                </div>
                            )}
                        </TabsContent>

                        <TabsContent value="candidates" className="mt-0">
                            <CandidateGroupsWidget />
                        </TabsContent>

                        <TabsContent value="po" className="mt-0">
                            <POTab />
                        </TabsContent>

                        <TabsContent value="recruiter" className="space-y-4 mt-0">
                            <RecruiterAnalytics period={dateMode} dateBasis={dateBasis} startDate={startDate} />
                        </TabsContent>

                        <TabsContent value="expert" className="space-y-4 mt-0">
                            <ExpertAnalytics period={dateMode} dateBasis={dateBasis} startDate={startDate} />
                        </TabsContent>

                        <TabsContent value="management" className="mt-0">
                            <ManagementReports />
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </DashboardLayout>
    );
}
