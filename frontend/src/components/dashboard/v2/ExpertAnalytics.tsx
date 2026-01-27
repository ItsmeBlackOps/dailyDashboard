import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

interface ExpertStat {
    expert: string;
    totalTasks: number;
    completedTasks: number;
    activeTasks: number;
    completionRate: number;
    roundCounts: Record<string, number>;
}

export function ExpertAnalytics({ period }: { period: string }) {
    const [stats, setStats] = useState<ExpertStat[]>([]);
    const [loading, setLoading] = useState(true);
    const { authFetch } = useAuth();

    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true);
            try {
                const res = await authFetch(`${API_URL}/api/dashboard/stats/expert?period=${period}`);
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
    }, [period, authFetch]);

    if (loading) {
        return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle>Expert Performance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Expert</TableHead>
                                    <TableHead className="text-right">Total Tasks</TableHead>
                                    <TableHead className="text-right">Active</TableHead>
                                    <TableHead className="text-right">Completed</TableHead>
                                    <TableHead className="text-right">Rate</TableHead>
                                    <TableHead>Common Rounds</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stats.map((s, idx) => (
                                    <TableRow key={idx}>
                                        <TableCell className="font-medium">{s.expert}</TableCell>
                                        <TableCell className="text-right">{s.totalTasks}</TableCell>
                                        <TableCell className="text-right">{s.activeTasks}</TableCell>
                                        <TableCell className="text-right">{s.completedTasks}</TableCell>
                                        <TableCell className="text-right">
                                            <Badge variant={s.completionRate > 80 ? 'default' : 'secondary'}>
                                                {s.completionRate.toFixed(1)}%
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground">
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
        </div>
    );
}
