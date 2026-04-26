import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { TaskSheet } from '@/components/shared/TaskSheet';
import { PODraftSheet } from '@/components/shared/PODraftSheet';
import type { TaskSheetPrefill } from '@/components/shared/TaskSheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Loader2, ChevronDown, ChevronRight, Search, ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface RecruiterStat {
    _id: string;
    totalInterviewsSent: number;
    completed: number;
    cancelled: number;
    rescheduled: number;
    notDone: number;
    qualityScore: number;
    roundCounts: Record<string, number>;
    teamLead?: string;
    // Buckets
    assigned?: number;
    acknowledged?: number;
    pending?: number;
}

interface GroupedStats {
    teamLead: string;
    members: RecruiterStat[];
    totalSent: number;
    totalCompleted: number;
}

interface DrilldownTask {
    _id?: string;
    'Candidate Name': string;
    'Email ID'?: string;
    candidateId?: string | null;
    'Date of Interview': string;
    'Start Time Of Interview': string;
    'End Time Of Interview'?: string;
    'End Client': string;
    'status': string;
    'Interview Round': string;
    'Actual Round': string;
    'Vendor'?: string;
    'sender'?: string;
    'assignedTo'?: string;
    'assignedExpert'?: string;
    'assignedAt'?: string | null;
    'suggestions'?: string[];
}

interface RecruiterDataResponse {
    bySender: RecruiterStat[];
    byOwner: RecruiterStat[];
}

export function RecruiterAnalytics({ period, dateBasis, startDate }: { period: string; dateBasis: string, startDate?: string }) {
    const navigate = useNavigate();
    const [fullData, setFullData] = useState<RecruiterDataResponse>({ bySender: [], byOwner: [] });
    const [viewMode, setViewMode] = useState<'sender' | 'owner'>('sender');
    const [loading, setLoading] = useState(true);
    const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
    const { authFetch, user } = useAuth();
    const role = (localStorage.getItem('role') || '').toLowerCase();

    // Drilldown state
    const [selectedRecruiter, setSelectedRecruiter] = useState<string | null>(null);
    const [drilldownTasks, setDrilldownTasks] = useState<DrilldownTask[]>([]);
    const [loadingDrilldown, setLoadingDrilldown] = useState(false);
    const [statusFilter, setStatusFilter] = useState('all');
    const [interviewRoundFilter, setInterviewRoundFilter] = useState('all');
    const [actualRoundFilter, setActualRoundFilter] = useState('all');
    const [drilldownSearch, setDrilldownSearch] = useState('');
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [poPrefill, setPoPrefill] = useState<TaskSheetPrefill | null>(null);
    const [poSheetOpen, setPoSheetOpen] = useState(false);

    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true);
            try {
                let url = `${API_URL}/api/dashboard/stats/recruiter?period=${period}&dateBasis=${dateBasis}`;
                if (startDate) url += `&startDate=${startDate}`;
                const res = await authFetch(url);
                const data = await res.json();
                if (data.success) {
                    // Handle both new object format and potential legacy array format (just in case)
                    if (Array.isArray(data.data)) {
                        setFullData({ bySender: data.data, byOwner: [] });
                    } else {
                        setFullData(data.data);
                    }
                }
            } catch (error) {
                console.error("Failed to fetch recruiter stats", error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, [period, dateBasis, startDate, authFetch]);

    useEffect(() => {
        if (selectedRecruiter) {
            const fetchDrilldown = async () => {
                setLoadingDrilldown(true);
                try {
                    let url = `${API_URL}/api/dashboard/stats/recruiter/drilldown?period=${period}&recruiterEmail=${encodeURIComponent(selectedRecruiter)}&dateBasis=${dateBasis}&viewMode=${viewMode}`;
                    if (startDate) url += `&startDate=${startDate}`;
                    if (statusFilter !== 'all') url += `&status=${encodeURIComponent(statusFilter.toLowerCase())}`;
                    if (interviewRoundFilter !== 'all') url += `&interviewRound=${encodeURIComponent(interviewRoundFilter)}`;
                    if (actualRoundFilter !== 'all') url += `&actualRound=${encodeURIComponent(actualRoundFilter)}`;

                    const res = await authFetch(url);
                    const data = await res.json();
                    if (data.success) {
                        setDrilldownTasks(data.data);
                    }
                } catch (error) {
                    console.error("Failed to fetch drilldown", error);
                } finally {
                    setLoadingDrilldown(false);
                }
            };
            fetchDrilldown();
        } else {
            setDrilldownTasks([]);
        }
    }, [selectedRecruiter, period, dateBasis, startDate, statusFilter, interviewRoundFilter, actualRoundFilter, viewMode, authFetch]);

    const activeStats = viewMode === 'sender' ? fullData.bySender : fullData.byOwner;

    const toggleTeam = (teamName: string) => {
        setExpandedTeams(prev => {
            const next = new Set(prev);
            if (next.has(teamName)) {
                next.delete(teamName);
            } else {
                next.add(teamName);
            }
            return next;
        });
    };

    if (loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-[200px] w-full" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Skeleton className="h-[300px] w-full" />
                    <Skeleton className="h-[300px] w-full" />
                </div>
            </div>
        );
    }

    // Group by team for management roles
    const shouldGroupByTeam = ['admin', 'mm', 'am', 'mam'].includes(role);
    const shouldShowOwnTeam = ['lead', 'mlead'].includes(role);

    let groupedStats: GroupedStats[] = [];

    if (shouldGroupByTeam || shouldShowOwnTeam) {
        const teamMap = new Map<string, RecruiterStat[]>();

        activeStats.forEach(stat => {
            const team = stat.teamLead || 'No Team';
            if (!teamMap.has(team)) {
                teamMap.set(team, []);
            }
            teamMap.get(team)!.push(stat);
        });

        groupedStats = Array.from(teamMap.entries()).map(([teamLead, members]) => ({
            teamLead,
            members,
            totalSent: members.reduce((sum, m) => sum + m.totalInterviewsSent, 0),
            totalCompleted: members.reduce((sum, m) => sum + m.completed, 0),
        })).sort((a, b) => b.totalSent - a.totalSent);
    }

    // Chart Data
    const chartData = activeStats.slice(0, 10).map(s => ({
        name: s._id?.split('@')[0]?.substring(0, 15) || 'Unknown',
        fullName: s._id, // Store ID to select on click
        Sent: s.totalInterviewsSent,
        Completed: s.completed,
        NotDone: s.notDone
    }));

    // Chart onClick
    const handleBarClick = (data: any) => {
        if (data && data.activePayload && data.activePayload.length > 0) {
            const payload = data.activePayload[0].payload;
            setStatusFilter('all');
            setInterviewRoundFilter('all');
            setActualRoundFilter('all');
            setSelectedRecruiter(payload.fullName || payload.name);
        }
    };

    const openRecruiterDrilldown = (recruiterId: string) => {
        setStatusFilter('all');
        setInterviewRoundFilter('all');
        setActualRoundFilter('all');
        setDrilldownSearch('');
        setSelectedRecruiter(recruiterId);
    };

    const buildOptions = (values: Array<string | undefined>) => {
        const map = new Map<string, string>();
        values.forEach((value) => {
            const trimmed = (value || '').trim();
            if (!trimmed) return;
            const key = trimmed.toLowerCase();
            if (!map.has(key)) map.set(key, trimmed);
        });
        return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
    };

    const statusOptions = buildOptions(drilldownTasks.map((task) => task.status));
    const interviewRoundOptions = buildOptions(drilldownTasks.map((task) => task['Interview Round']));
    const actualRoundOptions = buildOptions(drilldownTasks.map((task) => task['Actual Round']));

    const filteredDrilldown = useMemo(() => {
        if (!drilldownSearch.trim()) return drilldownTasks;
        const q = drilldownSearch.toLowerCase();
        return drilldownTasks.filter(t =>
            (t['Candidate Name'] || '').toLowerCase().includes(q) ||
            (t['End Client'] || '').toLowerCase().includes(q)
        );
    }, [drilldownTasks, drilldownSearch]);

    return (
        <div className="space-y-4 md:space-y-6">
            <Tabs defaultValue="sender" value={viewMode} onValueChange={(v) => setViewMode(v as 'sender' | 'owner')}>
                <div className="flex items-center justify-between mb-4">
                    <TabsList>
                        <TabsTrigger value="sender">By Sender</TabsTrigger>
                        <TabsTrigger value="owner">By Owner</TabsTrigger>
                    </TabsList>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base md:text-lg">Recruiter Performance (Top 10 - {viewMode === 'sender' ? 'Sent' : 'Owned'})</CardTitle>
                        </CardHeader>
                        <CardContent className="h-[300px] md:h-[400px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={chartData} layout="vertical" onClick={handleBarClick} className="cursor-pointer">
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" />
                                    <YAxis dataKey="name" type="category" width={100} fontSize={12} />
                                    <Tooltip />
                                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                                    <Bar dataKey="Sent" fill="var(--primary, #8b5cf6)" />
                                    <Bar dataKey="Completed" fill="var(--aurora-emerald, #10b981)" />
                                    <Bar dataKey="NotDone" fill="var(--destructive, #ef4444)" />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base md:text-lg">Quick Summary</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-2 text-sm md:text-base">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total Recruiters:</span>
                                    <span className="font-bold">{activeStats.length}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total Interviews Sent:</span>
                                    <span className="font-bold">{activeStats.reduce((sum, s) => sum + s.totalInterviewsSent, 0)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total Completed:</span>
                                    <span className="font-bold text-aurora-emerald">{activeStats.reduce((sum, s) => sum + s.completed, 0)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total Not Done:</span>
                                    <span className="font-bold text-destructive">{activeStats.reduce((sum, s) => sum + s.notDone, 0)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total Cancelled:</span>
                                    <span className="font-bold text-aurora-amber">{activeStats.reduce((sum, s) => sum + s.cancelled, 0)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total Rescheduled:</span>
                                    <span className="font-bold text-primary">{activeStats.reduce((sum, s) => sum + s.rescheduled, 0)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total Assigned:</span>
                                    <span className="font-bold">{activeStats.reduce((sum, s) => sum + (s.assigned || 0), 0)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total Acknowledged:</span>
                                    <span className="font-bold">{activeStats.reduce((sum, s) => sum + (s.acknowledged || 0), 0)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total Pending:</span>
                                    <span className="font-bold">{activeStats.reduce((sum, s) => sum + (s.pending || 0), 0)}</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card className="mt-4">
                    <CardHeader>
                        <CardTitle className="text-base md:text-lg">
                            {shouldGroupByTeam || shouldShowOwnTeam ? 'Team-Wise Breakdown' : 'Detailed KPIs'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="max-h-[500px] overflow-auto">
                        {(shouldGroupByTeam || shouldShowOwnTeam) && groupedStats.length > 0 ? (
                            <div className="space-y-2">
                                {groupedStats.map((group) => (
                                    <Collapsible
                                        key={group.teamLead}
                                        open={expandedTeams.has(group.teamLead)}
                                        onOpenChange={() => toggleTeam(group.teamLead)}
                                    >
                                        <div className="border rounded-lg overflow-hidden">
                                            <CollapsibleTrigger className="w-full">
                                                <div className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors">
                                                    <div className="flex items-center gap-2">
                                                        {expandedTeams.has(group.teamLead) ?
                                                            <ChevronDown className="h-4 w-4" /> :
                                                            <ChevronRight className="h-4 w-4" />
                                                        }
                                                        <span className="font-semibold text-sm md:text-base">
                                                            {group.teamLead} ({group.members.length})
                                                        </span>
                                                    </div>
                                                    <div className="flex gap-4 text-xs md:text-sm">
                                                        <span className="text-muted-foreground">
                                                            Sent: <span className="font-bold text-foreground">{group.totalSent}</span>
                                                        </span>
                                                        <span className="text-muted-foreground">
                                                            Done: <span className="font-bold text-aurora-emerald">{group.totalCompleted}</span>
                                                        </span>
                                                    </div>
                                                </div>
                                            </CollapsibleTrigger>
                                            <CollapsibleContent>
                                                <div className="overflow-x-auto">
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow>
                                                                <TableHead className="text-xs md:text-sm">Recruiter</TableHead>
                                                                <TableHead className="text-right text-xs md:text-sm">Sent</TableHead>
                                                                <TableHead className="text-right text-xs md:text-sm">Done</TableHead>
                                                                <TableHead className="text-right text-xs md:text-sm">Score</TableHead>
                                                                <TableHead className="text-right hidden sm:table-cell text-xs md:text-sm">Canc/Resch</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {group.members.map((s, idx) => (
                                                                    <TableRow
                                                                        key={idx}
                                                                        className="cursor-pointer hover:bg-muted/50"
                                                                        onClick={() => openRecruiterDrilldown(s._id)}
                                                                    >
                                                                    <TableCell className="font-medium text-primary text-xs md:text-sm truncate max-w-[150px]">{s._id}</TableCell>
                                                                    <TableCell className="text-right text-xs md:text-sm">{s.totalInterviewsSent}</TableCell>
                                                                    <TableCell className="text-right text-xs md:text-sm">{s.completed}</TableCell>
                                                                    <TableCell className="text-right font-bold text-primary text-xs md:text-sm">{s.qualityScore.toFixed(1)}</TableCell>
                                                                    <TableCell className="text-right hidden sm:table-cell text-xs md:text-sm">{s.cancelled + s.rescheduled}</TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            </CollapsibleContent>
                                        </div>
                                    </Collapsible>
                                ))}
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="text-xs md:text-sm">Recruiter</TableHead>
                                            <TableHead className="text-right text-xs md:text-sm">Sent</TableHead>
                                            <TableHead className="text-right text-xs md:text-sm">Done</TableHead>
                                            <TableHead className="text-right text-xs md:text-sm">Score</TableHead>
                                            <TableHead className="text-right hidden sm:table-cell text-xs md:text-sm">Canc/Resch</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {activeStats.map((s, idx) => (
                                            <TableRow
                                                key={idx}
                                                className="cursor-pointer hover:bg-muted/50"
                                                onClick={() => openRecruiterDrilldown(s._id)}
                                            >
                                                <TableCell className="font-medium text-primary text-xs md:text-sm truncate max-w-[150px] md:max-w-none">{s._id}</TableCell>
                                                <TableCell className="text-right text-xs md:text-sm">{s.totalInterviewsSent}</TableCell>
                                                <TableCell className="text-right text-xs md:text-sm">{s.completed}</TableCell>
                                                <TableCell className="text-right font-bold text-primary text-xs md:text-sm">{s.qualityScore.toFixed(1)}</TableCell>
                                                <TableCell className="text-right hidden sm:table-cell text-xs md:text-sm">{s.cancelled + s.rescheduled}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </Tabs>

            <Dialog open={!!selectedRecruiter} onOpenChange={(open) => !open && setSelectedRecruiter(null)}>
                <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Details for {selectedRecruiter}</DialogTitle>
                        <DialogDescription>
                            Recent interviewed candidates in this period
                        </DialogDescription>
                    </DialogHeader>

                    {loadingDrilldown ? (
                        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
                    ) : (
                        <>
                            {/* Search + filters */}
                            <div className="flex flex-wrap gap-2 pb-3">
                                <div className="relative flex-1 min-w-[160px]">
                                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                                    <Input placeholder="Search candidate or client…" className="pl-8 h-8 text-xs"
                                        value={drilldownSearch} onChange={e => setDrilldownSearch(e.target.value)} />
                                </div>
                                <Select value={statusFilter} onValueChange={setStatusFilter}>
                                    <SelectTrigger className="w-[150px] h-8 text-xs">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Statuses</SelectItem>
                                        {statusOptions.map((status) => (
                                            <SelectItem key={status} value={status}>{status}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select value={interviewRoundFilter} onValueChange={setInterviewRoundFilter}>
                                    <SelectTrigger className="w-[165px] h-8 text-xs">
                                        <SelectValue placeholder="Interview Round" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Rounds</SelectItem>
                                        {interviewRoundOptions.map((round) => (
                                            <SelectItem key={round} value={round}>{round}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select value={actualRoundFilter} onValueChange={setActualRoundFilter}>
                                    <SelectTrigger className="w-[165px] h-8 text-xs">
                                        <SelectValue placeholder="Actual Round" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Actual Rounds</SelectItem>
                                        {actualRoundOptions.map((round) => (
                                            <SelectItem key={round} value={round}>{round}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <span className="text-xs text-muted-foreground self-center ml-auto">{filteredDrilldown.length} records</span>
                            </div>

                            <div className="overflow-x-auto">
                            <Table className="min-w-[640px]">
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="text-xs">Candidate</TableHead>
                                        <TableHead className="text-xs">Date</TableHead>
                                        <TableHead className="text-xs">Time</TableHead>
                                        <TableHead className="text-xs">Client</TableHead>
                                        <TableHead className="text-xs">Status</TableHead>
                                        <TableHead className="text-xs">Round</TableHead>
                                        <TableHead className="text-xs">Actual Round</TableHead>
                                        <TableHead className="w-8" />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredDrilldown.map((task, idx) => (
                                        <TableRow key={idx}
                                            className={task._id ? 'cursor-pointer hover:bg-muted/50' : ''}
                                            onClick={() => task._id && setSelectedTaskId(task._id)}>
                                            <TableCell className="font-medium text-xs text-primary">{task['Candidate Name']}</TableCell>
                                            <TableCell className="text-xs">{task['Date of Interview']}</TableCell>
                                            <TableCell className="text-xs">{task['Start Time Of Interview']}</TableCell>
                                            <TableCell className="text-xs">{task['End Client']}</TableCell>
                                            <TableCell>
                                                <Badge variant={['completed', 'done'].includes((task.status || '').toLowerCase()) ? 'default' : 'outline'}
                                                    className="text-[10px]">
                                                    {task.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-xs">{task['Interview Round']}</TableCell>
                                            <TableCell className="text-xs">{task['Actual Round']}</TableCell>
                                            <TableCell onClick={e => e.stopPropagation()}>
                                                {task.candidateId && (
                                                    <button className="text-primary hover:text-primary/80"
                                                        title="View full profile"
                                                        onClick={() => navigate(`/candidate/${task.candidateId}`)}>
                                                        <ExternalLink className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {filteredDrilldown.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={8} className="text-center text-muted-foreground py-4">
                                                No tasks found for this period.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* Task detail drawer */}
            <TaskSheet
  taskId={selectedTaskId}
  onClose={() => setSelectedTaskId(null)}
  onCreatePO={(prefill) => {
    setPoPrefill(prefill);
    setPoSheetOpen(true);
  }}
/>
<PODraftSheet
  open={poSheetOpen}
  onClose={() => { setPoSheetOpen(false); setPoPrefill(null); }}
  prefill={poPrefill}
/>
        </div>
    );
}
