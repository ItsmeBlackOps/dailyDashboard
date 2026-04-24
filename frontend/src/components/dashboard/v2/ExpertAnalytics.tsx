import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { Loader2, Search, ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TaskSheet } from '@/components/shared/TaskSheet';
import { PODraftSheet } from '@/components/shared/PODraftSheet';
import type { TaskSheetPrefill } from '@/components/shared/TaskSheet';

interface ExpertStat {
    expert: string;
    totalTasks: number;
    completedTasks: number;
    activeBucket: number;
    acknowledgedShare: number;
    roundCounts: Record<string, number>;
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

export function ExpertAnalytics({ period, startDate, dateBasis }: { period: string; startDate?: string; dateBasis?: string }) {
    const navigate = useNavigate();
    const [stats, setStats] = useState<ExpertStat[]>([]);
    const [loading, setLoading] = useState(true);
    const { authFetch } = useAuth();

    // Drilldown
    const [selectedExpert, setSelectedExpert] = useState<string | null>(null);
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
                let url = `${API_URL}/api/dashboard/stats/expert?period=${period}`;
                if (startDate) url += `&startDate=${startDate}`;
                if (dateBasis) url += `&dateBasis=${dateBasis}`;
                const res = await authFetch(url);
                const data = await res.json();
                if (data.success) {
                    setStats(data.data);
                }
            } catch (error) {
                console.error("Failed to fetch expert stats", error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, [period, startDate, dateBasis, authFetch]);

    useEffect(() => {
        if (selectedExpert) {
            const fetchDrilldown = async () => {
                setLoadingDrilldown(true);
                try {
                    let url = `${API_URL}/api/dashboard/stats/expert/drilldown?period=${period}&expertEmail=${encodeURIComponent(selectedExpert)}`;
                    if (startDate) url += `&startDate=${startDate}`;
                    if (dateBasis) url += `&dateBasis=${dateBasis}`;
                    if (statusFilter !== 'all') url += `&status=${encodeURIComponent(statusFilter.toLowerCase())}`;
                    if (interviewRoundFilter !== 'all') url += `&interviewRound=${encodeURIComponent(interviewRoundFilter)}`;
                    if (actualRoundFilter !== 'all') url += `&actualRound=${encodeURIComponent(actualRoundFilter)}`;

                    const res = await authFetch(url);
                    const data = await res.json();
                    if (data.success) {
                        setDrilldownTasks(data.data);
                    }
                } catch (error) {
                    console.error("Failed to fetch functionality drilldown", error);
                } finally {
                    setLoadingDrilldown(false);
                }
            };
            fetchDrilldown();
        } else {
            setDrilldownTasks([]);
        }
    }, [selectedExpert, period, startDate, dateBasis, statusFilter, interviewRoundFilter, actualRoundFilter, authFetch]);

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

    // useMemo must be before any early return (Rules of Hooks)
    const filteredDrilldown = useMemo(() => {
        if (!drilldownSearch.trim()) return drilldownTasks;
        const q = drilldownSearch.toLowerCase();
        return drilldownTasks.filter(t =>
            (t['Candidate Name'] || '').toLowerCase().includes(q) ||
            (t['End Client'] || '').toLowerCase().includes(q)
        );
    }, [drilldownTasks, drilldownSearch]);

    if (loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-[200px] w-full" />
                <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <Skeleton key={i} className="h-16 w-full" />
                    ))}
                </div>
            </div>
        );
    }

    const openExpertDrilldown = (expertId: string) => {
        setStatusFilter('all');
        setInterviewRoundFilter('all');
        setActualRoundFilter('all');
        setDrilldownSearch('');
        setSelectedExpert(expertId);
    };

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Expert Utilization & Performance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Expert</TableHead>
                                    <TableHead className="text-right">Total Tasks</TableHead>
                                    <TableHead className="text-right">Active Bucket</TableHead>
                                    <TableHead className="text-right">Completed</TableHead>
                                    <TableHead className="text-right">Ack. Rate</TableHead>
                                    <TableHead>Top Rounds</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stats.map((s, idx) => (
                                    <TableRow
                                        key={idx}
                                        className="cursor-pointer hover:bg-muted/50"
                                        onClick={() => openExpertDrilldown(s.expert)}
                                    >
                                        <TableCell className="font-medium text-blue-600 dark:text-blue-400">{s.expert}</TableCell>
                                        <TableCell className="text-right">{s.totalTasks}</TableCell>
                                        <TableCell className="text-right text-blue-600 font-semibold">{s.activeBucket}</TableCell>
                                        <TableCell className="text-right">{s.completedTasks}</TableCell>
                                        <TableCell className="text-right">
                                            <Badge variant={(Number.isFinite(s.acknowledgedShare) ? s.acknowledgedShare : 0) > 90 ? 'outline' : 'secondary'}
                                                className={(Number.isFinite(s.acknowledgedShare) ? s.acknowledgedShare : 0) < 80 ? 'bg-red-50 text-red-700' : ''}>
                                                {(Number.isFinite(s.acknowledgedShare) ? s.acknowledgedShare : 0).toFixed(1)}%
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground w-[200px] truncate">
                                            {Object.entries(s.roundCounts)
                                                .sort(([, a], [, b]) => b - a)
                                                .slice(0, 3)
                                                .map(([k, v]) => `${k} (${v})`)
                                                .join(', ')}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>

            <Dialog open={!!selectedExpert} onOpenChange={(open) => !open && setSelectedExpert(null)}>
                <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Details for {selectedExpert}</DialogTitle>
                        <DialogDescription>
                            Tasks assigned in this period — click any row for full task details
                        </DialogDescription>
                    </DialogHeader>

                    {loadingDrilldown ? (
                        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
                    ) : (
                        <>
                            <div className="flex flex-wrap gap-2 pb-3">
                                <div className="relative flex-1 min-w-[160px]">
                                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                                    <Input placeholder="Search candidate or client…" className="pl-8 h-8 text-xs"
                                        value={drilldownSearch} onChange={e => setDrilldownSearch(e.target.value)} />
                                </div>
                                <Select value={statusFilter} onValueChange={setStatusFilter}>
                                    <SelectTrigger className="w-[150px] h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Statuses</SelectItem>
                                        {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <Select value={interviewRoundFilter} onValueChange={setInterviewRoundFilter}>
                                    <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Round" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Rounds</SelectItem>
                                        {interviewRoundOptions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <Select value={actualRoundFilter} onValueChange={setActualRoundFilter}>
                                    <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue placeholder="Actual Round" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Actual Rounds</SelectItem>
                                        {actualRoundOptions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
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
                                            <TableCell className="font-medium text-xs text-blue-600 dark:text-blue-400">{task['Candidate Name']}</TableCell>
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
                                                    <button className="text-blue-500 hover:text-blue-400"
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
