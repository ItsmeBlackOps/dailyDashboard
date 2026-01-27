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
    totalInterviews: number;
    statusBreakdown: { status: string; count: number }[];
    roundsDetail: string[];
}

export function RecruiterAnalytics({ period }: { period: string }) {
    const [stats, setStats] = useState<RecruiterStat[]>([]);
    const [loading, setLoading] = useState(true);
    const { authFetch } = useAuth();

    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true);
            try {
                const res = await authFetch(`${API_URL}/api/dashboard/stats/recruiter?period=${period}`);
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
    }, [period, authFetch]);

    if (loading) {
        return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    // Prepare Chart Data
    const chartData = stats.map(s => ({
        name: s._id || 'Unknown',
        Interviews: s.totalInterviews,
        Completed: s.statusBreakdown.find(b => b.status === 'Completed')?.count || 0
    }));

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Interview Volume by Recruiter</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="Interviews" fill="#3b82f6" />
                                <Bar dataKey="Completed" fill="#22c55e" />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Top Performers</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Recruiter</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead className="text-right">Active</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stats.slice(0, 5).map((s, idx) => (
                                    <TableRow key={idx}>
                                        <TableCell className="font-medium">{s._id}</TableCell>
                                        <TableCell className="text-right">{s.totalInterviews}</TableCell>
                                        <TableCell className="text-right">{s.statusBreakdown.find(x => x.status === 'Active')?.count || 0}</TableCell>
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
