import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { Loader2 } from 'lucide-react';
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

interface ExpertStat {
    expert: string;
    totalTasks: number;
    completedTasks: number;
    activeBucket: number;
    acknowledgedShare: number;
    roundCounts: Record<string, number>;
}

interface DrilldownTask {
    'Candidate Name': string;
    'Date of Interview': string;
    'Start Time Of Interview': string;
    'End Client': string;
    'status': string;
    'Interview Round': string;
    'Actual Round': string;
}

export function ExpertAnalytics({ period, startDate, dateBasis }: { period: string; startDate?: string; dateBasis?: string }) {
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
                            Tasks assigned in this period
                        </DialogDescription>
                    </DialogHeader>

                    {loadingDrilldown ? (
                        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
                    ) : (
                        <>
                            <div className="flex flex-wrap gap-3 pb-4">
                                <Select value={statusFilter} onValueChange={setStatusFilter}>
                                    <SelectTrigger className="w-[170px]">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Statuses</SelectItem>
                                        {statusOptions.map((status) => (
                                            <SelectItem key={status} value={status}>
                                                {status}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select value={interviewRoundFilter} onValueChange={setInterviewRoundFilter}>
                                    <SelectTrigger className="w-[190px]">
                                        <SelectValue placeholder="Interview Round" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Interview Rounds</SelectItem>
                                        {interviewRoundOptions.map((round) => (
                                            <SelectItem key={round} value={round}>
                                                {round}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select value={actualRoundFilter} onValueChange={setActualRoundFilter}>
                                    <SelectTrigger className="w-[190px]">
                                        <SelectValue placeholder="Actual Round" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Actual Rounds</SelectItem>
                                        {actualRoundOptions.map((round) => (
                                            <SelectItem key={round} value={round}>
                                                {round}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Candidate</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Time</TableHead>
                                        <TableHead>Client</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Round</TableHead>
                                        <TableHead>Actual Round</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {drilldownTasks.map((task, idx) => (
                                        <TableRow key={idx}>
                                            <TableCell className="font-medium">{task['Candidate Name']}</TableCell>
                                            <TableCell>{task['Date of Interview']}</TableCell>
                                            <TableCell>{task['Start Time Of Interview']}</TableCell>
                                            <TableCell>{task['End Client']}</TableCell>
                                            <TableCell>
                                                <Badge variant={['completed', 'done'].includes((task.status || '').toLowerCase()) ? 'default' : 'outline'}>
                                                    {task.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{task['Interview Round']}</TableCell>
                                            <TableCell>{task['Actual Round']}</TableCell>
                                        </TableRow>
                                    ))}
                                    {drilldownTasks.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={7} className="text-center text-muted-foreground py-4">
                                                No tasks found for this period.
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
