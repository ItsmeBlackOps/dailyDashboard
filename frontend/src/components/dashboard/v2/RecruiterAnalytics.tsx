import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Loader2 } from 'lucide-react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

interface RecruiterStat {
    _id: string; // Recruiter Name
    totalInterviewsSent: number;
    completed: number;
    cancelled: number;
    rescheduled: number;
    notDone: number;
    qualityScore: number;
    roundCounts: Record<string, number>;
}

export function RecruiterAnalytics({ period, dateBasis }: { period: string; dateBasis: string }) {
    const [stats, setStats] = useState<RecruiterStat[]>([]);
    const [loading, setLoading] = useState(true);
    const { authFetch } = useAuth();

    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true);
            try {
                const res = await authFetch(`${API_URL}/api/dashboard/stats/recruiter?period=${period}&dateBasis=${dateBasis}`);
                const data = await res.json();
                if (data.success) {
                    setStats(data.data);
                }
            } catch (error) {
                console.error("Failed to fetch recruiter stats", error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, [period, dateBasis, authFetch]);

    if (loading) {
        return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    const chartData = stats.slice(0, 15).map(s => ({
        name: s._id || 'Unknown',
        Sent: s.totalInterviewsSent,
        Completed: s.completed,
        NotDone: s.notDone
    }));

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Recruiter Performance (Top 15)</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[400px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} interval={0} />
                                <YAxis />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="Sent" fill="#3b82f6" />
                                <Bar dataKey="Completed" fill="#22c55e" />
                                <Bar dataKey="NotDone" fill="#ef4444" />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Detailed KPIs</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[400px] overflow-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Recruiter</TableHead>
                                    <TableHead className="text-right">Sent</TableHead>
                                    <TableHead className="text-right">Done</TableHead>
                                    <TableHead className="text-right">Score</TableHead>
                                    <TableHead className="text-right hidden sm:table-cell">Canc/Resch</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stats.map((s, idx) => (
                                    <TableRow key={idx}>
                                        <TableCell className="font-medium">{s._id}</TableCell>
                                        <TableCell className="text-right">{s.totalInterviewsSent}</TableCell>
                                        <TableCell className="text-right">{s.completed}</TableCell>
                                        <TableCell className="text-right font-bold text-blue-600">{s.qualityScore.toFixed(1)}</TableCell>
                                        <TableCell className="text-right hidden sm:table-cell">{s.cancelled + s.rescheduled}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
