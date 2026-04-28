import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from '@/hooks/useAuth';
import InterviewSupportTaskList from '@/components/admin/InterviewSupportTaskList';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

// ── Types ──────────────────────────────────────────────────────────────────

interface UnprocessedEmail {
  _id: string;
  subject: string;
  from: string;
  receivedAt: string;
  snippet: string;
}

interface FailedAssignRow {
  _id: string;
  candidateName: string;
  technology: string;
  endClient: string;
  receivedAt: string;
  failureReason?: string;
}

interface ProcessingLogEntry {
  _id: string;
  action: string;
  performedBy: string;
  timestamp: string;
  details?: string;
  level?: 'info' | 'warn' | 'error';
}

interface ProcessingStats {
  totalProcessed: number;
  totalFailed: number;
  totalPending: number;
  totalAssigned: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function AdminInterviewSupport() {
  const navigate = useNavigate();
  const { authFetch, refreshAccessToken } = useAuth();
  const queryClient = useQueryClient();

  const userEmail = (localStorage.getItem('email') || '').trim().toLowerCase();
  if (userEmail !== 'harsh.patel@silverspaceinc.com') {
    navigate('/');
    return null;
  }

  return <AdminInterviewSupportContent authFetch={authFetch} refreshAccessToken={refreshAccessToken} queryClient={queryClient} />;
}

// Separate inner component so hooks run unconditionally after guard
function AdminInterviewSupportContent({
  authFetch,
  refreshAccessToken,
  queryClient,
}: {
  authFetch: ReturnType<typeof useAuth>['authFetch'];
  refreshAccessToken: ReturnType<typeof useAuth>['refreshAccessToken'];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  // Socket subscription
  useEffect(() => {
    const token = localStorage.getItem('accessToken') || '';
    const socket: Socket = io(SOCKET_URL, { auth: { token }, autoConnect: false });

    const onToken = async () => {
      await refreshAccessToken();
      socket.auth = { token: localStorage.getItem('accessToken') || '' };
      socket.connect();
    };
    socket.connect();

    socket.on('interviewSupportTaskUpdated', () => {
      queryClient.invalidateQueries({ queryKey: ['interviewSupportTasks'] });
    });

    return () => { socket.disconnect(); };
  }, [refreshAccessToken, queryClient]);

  return (
    <DashboardLayout>
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Interview Support</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Admin — manage interview support tasks, email processing, and audit logs</p>
      </div>

      <Tabs defaultValue="all-tasks">
        <TabsList>
          <TabsTrigger value="all-tasks">All Tasks</TabsTrigger>
          <TabsTrigger value="unprocessed">Unprocessed</TabsTrigger>
          <TabsTrigger value="failed">Failed Auto-Assigns</TabsTrigger>
          <TabsTrigger value="logs">Processing Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="all-tasks" className="mt-4">
          <InterviewSupportTaskList />
        </TabsContent>

        <TabsContent value="unprocessed" className="mt-4">
          <UnprocessedTab authFetch={authFetch} />
        </TabsContent>

        <TabsContent value="failed" className="mt-4">
          <FailedTab authFetch={authFetch} queryClient={queryClient} />
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <LogsTab authFetch={authFetch} />
        </TabsContent>
      </Tabs>
    </div>
    </DashboardLayout>
  );
}

// ── Unprocessed Tab ────────────────────────────────────────────────────────

function UnprocessedTab({ authFetch }: { authFetch: ReturnType<typeof useAuth>['authFetch'] }) {
  const [date, setDate] = useState(today());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [scanError, setScanError] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery<{ success: boolean; emails: UnprocessedEmail[] }>({
    queryKey: ['unprocessedEmails', date],
    queryFn: async () => {
      const res = await authFetch(`${API_URL}/api/admin/interview-support/unprocessed?date=${date}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      return json;
    },
  });

  const emails = data?.emails ?? [];

  const handleScanOutlook = async () => {
    setScanning(true);
    setScanError('');
    try {
      const res = await authFetch(`${API_URL}/api/admin/interview-support/scan-outlook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Scan failed');
      refetch();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  };

  const handlePushToKafka = async () => {
    if (selected.size === 0) return;
    setPushing(true);
    try {
      const res = await authFetch(`${API_URL}/api/admin/interview-support/push-kafka`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailIds: Array.from(selected) }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Push failed');
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['unprocessedEmails'] });
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Push failed');
    } finally {
      setPushing(false);
    }
  };

  const toggleAll = () => {
    if (selected.size === emails.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(emails.map((e) => e._id)));
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <CardTitle className="text-base">Unprocessed Emails</CardTitle>
          <Badge variant="secondary">{emails.length}</Badge>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-36 h-8 text-sm"
            />
            <Button size="sm" variant="outline" onClick={handleScanOutlook} disabled={scanning}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${scanning ? 'animate-spin' : ''}`} />
              {scanning ? 'Scanning…' : 'Scan Outlook'}
            </Button>
            <Button
              size="sm"
              onClick={handlePushToKafka}
              disabled={selected.size === 0 || pushing}
            >
              {pushing ? 'Pushing…' : `Push to Kafka${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </Button>
          </div>
        </div>
        {scanError && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive flex items-center gap-2 mt-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {scanError}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="w-10">
                <Checkbox
                  checked={emails.length > 0 && selected.size === emails.length}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Subject</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">From</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Received</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Snippet</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell>
              </TableRow>
            ) : emails.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No unprocessed emails for this date</TableCell>
              </TableRow>
            ) : (
              emails.map((email) => (
                <TableRow key={email._id} className="hover:bg-muted/30 transition-colors">
                  <TableCell>
                    <Checkbox
                      checked={selected.has(email._id)}
                      onCheckedChange={(v) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (v) next.add(email._id); else next.delete(email._id);
                          return next;
                        });
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-sm font-medium">{email.subject}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{email.from}</TableCell>
                  <TableCell className="text-sm text-nowrap text-muted-foreground">
                    {new Date(email.receivedAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{email.snippet}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Failed Auto-Assigns Tab ────────────────────────────────────────────────

function FailedTab({
  authFetch,
  queryClient,
}: {
  authFetch: ReturnType<typeof useAuth>['authFetch'];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [date, setDate] = useState(today());
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ success: boolean; tasks: FailedAssignRow[] }>({
    queryKey: ['failedAutoAssigns', date],
    queryFn: async () => {
      const res = await authFetch(`${API_URL}/api/admin/interview-support/failed-assigns?date=${date}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      return json;
    },
  });

  const tasks = data?.tasks ?? [];

  const handleRetry = async (taskId: string) => {
    setRetryingId(taskId);
    try {
      const res = await authFetch(
        `${API_URL}/api/admin/interview-support/tasks/${taskId}/retry-assign`,
        { method: 'POST' }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Retry failed');
      queryClient.invalidateQueries({ queryKey: ['failedAutoAssigns'] });
      queryClient.invalidateQueries({ queryKey: ['interviewSupportTasks'] });
    } catch {
      // silently fail — production would show a toast
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <CardTitle className="text-base">Failed Auto-Assigns</CardTitle>
          <Badge variant="secondary">{tasks.length}</Badge>
          <div className="ml-auto">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-36 h-8 text-sm"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30">
              <TableHead className="text-xs uppercase tracking-wider">Candidate</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Technology</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">End Client</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Received</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Failure Reason</TableHead>
              <TableHead className="text-xs uppercase tracking-wider">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell>
              </TableRow>
            ) : tasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No failed auto-assigns for this date</TableCell>
              </TableRow>
            ) : (
              tasks.map((task) => (
                <TableRow key={task._id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="text-sm font-medium">{task.candidateName}</TableCell>
                  <TableCell className="text-sm">{task.technology}</TableCell>
                  <TableCell className="text-sm">{task.endClient}</TableCell>
                  <TableCell className="text-sm text-nowrap text-muted-foreground">
                    {new Date(task.receivedAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-sm text-destructive">{task.failureReason || '—'}</TableCell>
                  <TableCell>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={retryingId === task._id}>
                          {retryingId === task._id ? 'Retrying…' : 'Retry Auto-Assign'}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Retry Auto-Assign?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Retry automatic assignment for <strong>{task.candidateName}</strong>? This will re-run the matching logic.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleRetry(task._id)}>
                            Retry
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Processing Logs Tab ────────────────────────────────────────────────────

function LogsTab({ authFetch }: { authFetch: ReturnType<typeof useAuth>['authFetch'] }) {
  const [date, setDate] = useState(today());
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery<{
    success: boolean;
    stats: ProcessingStats;
    logs: ProcessingLogEntry[];
  }>({
    queryKey: ['processingLogs', date],
    queryFn: async () => {
      const res = await authFetch(`${API_URL}/api/admin/interview-support/logs?date=${date}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed');
      return json;
    },
  });

  const stats = data?.stats;
  const logs = (data?.logs ?? []).filter((l) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      l.action?.toLowerCase().includes(q) ||
      l.performedBy?.toLowerCase().includes(q) ||
      l.details?.toLowerCase().includes(q)
    );
  });

  const levelClass = (level?: string) => {
    if (level === 'error') return 'text-destructive';
    if (level === 'warn') return 'text-aurora-amber';
    return 'text-foreground';
  };

  return (
    <div className="space-y-4">
      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Processed" value={stats.totalProcessed} color="text-aurora-emerald" />
          <StatCard label="Failed" value={stats.totalFailed} color="text-destructive" />
          <StatCard label="Pending" value={stats.totalPending} color="text-aurora-amber" />
          <StatCard label="Assigned" value={stats.totalAssigned} color="text-primary" />
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <CardTitle className="text-base">Audit Log</CardTitle>
            <Badge variant="secondary">{logs.length} entries</Badge>
            <div className="ml-auto flex items-center gap-2">
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-36 h-8 text-sm"
              />
              <Input
                placeholder="Search logs…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-44 h-8 text-sm"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[520px]">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs uppercase tracking-wider">Timestamp</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Action</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Performed By</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">Loading…</TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground text-sm">No logs for this date</TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log._id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="text-xs text-nowrap text-muted-foreground">
                        {new Date(log.timestamp).toLocaleString()}
                      </TableCell>
                      <TableCell className={`text-sm font-medium ${levelClass(log.level)}`}>
                        {log.action}
                      </TableCell>
                      <TableCell className="text-sm">{log.performedBy}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{log.details || '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
