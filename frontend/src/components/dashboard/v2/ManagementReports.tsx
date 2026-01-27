import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { Loader2, AlertTriangle } from 'lucide-react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';

interface AtRiskCandidate {
    'Candidate Name': string;
    Branch: string;
    Recruiter: string;
    interviewCount: number;
    lastInterview: string | null;
}

export function ManagementReports() {
    const [report, setReport] = useState<AtRiskCandidate[]>([]);
    const [loading, setLoading] = useState(true);
    const { authFetch } = useAuth();

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

    if (loading) {
        return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="space-y-6">
            <Card className="border-red-100 dark:border-red-900/50">
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-red-500" />
                        <CardTitle>Stagnant Candidates (Low Interaction)</CardTitle>
                    </div>
                    <CardDescription>Active candidates with the least number of interviews recorded.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Candidate</TableHead>
                                <TableHead>Branch</TableHead>
                                <TableHead>Recruiter</TableHead>
                                <TableHead className="text-right">Interviews</TableHead>
                                <TableHead className="text-right">Last Interview</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {report.map((c, idx) => (
                                <TableRow key={idx}>
                                    <TableCell className="font-medium">{c['Candidate Name']}</TableCell>
                                    <TableCell>{c.Branch}</TableCell>
                                    <TableCell>{c.Recruiter}</TableCell>
                                    <TableCell className="text-right">
                                        <Badge variant="outline" className={c.interviewCount === 0 ? "bg-red-50 text-red-700 border-red-200" : ""}>
                                            {c.interviewCount}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right text-xs text-muted-foreground">
                                        {c.lastInterview ? new Date(c.lastInterview).toLocaleDateString() : 'Never'}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}
