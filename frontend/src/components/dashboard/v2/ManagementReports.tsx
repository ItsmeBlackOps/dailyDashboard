import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth, API_URL } from '@/hooks/useAuth';
import { Loader2, AlertTriangle, Clock } from 'lucide-react';
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

interface AtRiskCandidate {
    _id: string;
    'Candidate Name': string;
    'Email ID': string;
    Branch: string;
    Recruiter: string;
    totalInterviews: number;
    recentInterviews: number;
    lastInterviewDate: string | null;
}

interface InterviewTask {
    'Date of Interview': string;
    'Job Title': string;
    'End Client': string;
    'Interview Round': string;
    status: string;
}

export function ManagementReports() {
    const navigate = useNavigate();
    const [report, setReport] = useState<AtRiskCandidate[]>([]);
    const [loading, setLoading] = useState(true);
    const { authFetch } = useAuth();
    const [selectedCandidate, setSelectedCandidate] = useState<AtRiskCandidate | null>(null);
    const [candidateTasks, setCandidateTasks] = useState<InterviewTask[]>([]);
    const [loadingTasks, setLoadingTasks] = useState(false);

    useEffect(() => {
        const fetchReport = async () => {
            setLoading(true);
            try {
                const res = await authFetch(`${API_URL}/api/dashboard/stats/management`);
                const data = await res.json();
                if (data.success) {
                    setReport(data.data);
                }
            } catch (error) {
                console.error("Failed to fetch report", error);
            } finally {
                setLoading(false);
            }
        };

        fetchReport();
    }, [authFetch]);

    useEffect(() => {
        if (selectedCandidate) {
            const fetchTasks = async () => {
                setLoadingTasks(true);
                try {
                    const res = await authFetch(`${API_URL}/api/dashboard/stats/management/drilldown?candidateEmail=${encodeURIComponent(selectedCandidate['Email ID'])}`);
                    const data = await res.json();
                    if (data.success) {
                        setCandidateTasks(data.data);
                    }
                } catch (error) {
                    console.error("Failed to fetch candidate tasks", error);
                } finally {
                    setLoadingTasks(false);
                }
            };
            fetchTasks();
        } else {
            setCandidateTasks([]);
        }
    }, [selectedCandidate, authFetch]);


    if (loading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-[100px] w-full" />
                <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <Card className="border-destructive/20">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                        <CardTitle>
                            Low Activity Candidates (At Risk)
                            <Badge variant="destructive" className="ml-2 text-sm">
                                {report.length}
                            </Badge>
                        </CardTitle>
                    </div>
                    <CardDescription>Active candidates with fewer than 3 interviews in the last 30 days.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Candidate</TableHead>
                                <TableHead>Branch</TableHead>
                                <TableHead>Recruiter owner</TableHead>
                                <TableHead className="text-right">Total Int.</TableHead>
                                <TableHead className="text-right">Last Interview</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {report.map((c, idx) => (
                                <TableRow
                                    key={idx}
                                    className="cursor-pointer hover:bg-muted/50"
                                    onClick={() => setSelectedCandidate(c)}
                                >
                                    <TableCell className="font-medium text-primary">{c['Candidate Name']}</TableCell>
                                    <TableCell>{c.Branch}</TableCell>
                                    <TableCell>{c.Recruiter}</TableCell>
                                    <TableCell className="text-right">{c.totalInterviews}</TableCell>
                                    <TableCell className="text-right flex justify-end items-center gap-2">
                                        <span className="text-muted-foreground">
                                            {c.lastInterviewDate ? new Date(c.lastInterviewDate).toLocaleDateString() : 'Never'}
                                        </span>
                                        {!c.lastInterviewDate && <Clock className="h-3 w-3 text-destructive" />}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Dialog open={!!selectedCandidate} onOpenChange={(open) => !open && setSelectedCandidate(null)}>
                <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <div className="flex items-center justify-between gap-2">
                            <DialogTitle>Interview History: {selectedCandidate?.['Candidate Name']}</DialogTitle>
                            {selectedCandidate?._id && (
                                <button
                                    className="text-xs text-primary hover:underline shrink-0"
                                    onClick={() => navigate(`/candidate/${selectedCandidate._id}`)}
                                >
                                    View Full Profile →
                                </button>
                            )}
                        </div>
                        <DialogDescription>
                            Recent activity and interview statuses.
                        </DialogDescription>
                    </DialogHeader>

                    {loadingTasks ? (
                        <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Client</TableHead>
                                    <TableHead>Round</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {candidateTasks.map((task, idx) => (
                                    <TableRow key={idx}>
                                        <TableCell>{task['Date of Interview']}</TableCell>
                                        <TableCell>{task['Job Title']}</TableCell>
                                        <TableCell>{task['End Client']}</TableCell>
                                        <TableCell>{task['Interview Round']}</TableCell>
                                        <TableCell>
                                            <Badge variant={['completed', 'done'].includes((task.status || '').toLowerCase()) ? 'default' : 'outline'}>
                                                {task.status}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {candidateTasks.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center text-muted-foreground py-4">
                                            No interview records found.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
