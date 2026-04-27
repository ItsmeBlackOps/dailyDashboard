import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { useAuth, API_URL } from '@/hooks/useAuth';
import InterviewSupportTaskDetail from './InterviewSupportTaskDetail';
import type { InterviewSupportTask } from './InterviewSupportTaskDetail';

const PAGE_SIZE = 15;

const ALL_STATUSES = ['All', 'Pending', 'Assigned', 'Acknowledged', 'Completed', 'Cancelled', 'Not Done', 'Rescheduled'];

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'Pending':
      return 'bg-aurora-amber/10 text-aurora-amber border-aurora-amber/20';
    case 'Assigned':
    case 'Acknowledged':
      return 'bg-primary/10 text-primary border-primary/20';
    case 'Completed':
      return 'bg-aurora-emerald/10 text-aurora-emerald border-aurora-emerald/20';
    case 'Cancelled':
    case 'Not Done':
      return 'bg-destructive/10 text-destructive border-destructive/20';
    case 'Rescheduled':
      return 'bg-muted text-muted-foreground border-border';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

interface TaskListResponse {
  success: boolean;
  tasks: InterviewSupportTask[];
  total: number;
  error?: string;
}

export default function InterviewSupportTaskList() {
  const { authFetch } = useAuth();
  const [statusFilter, setStatusFilter] = useState('All');
  const [candidateFilter, setCandidateFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);

  const queryParams = new URLSearchParams();
  if (statusFilter && statusFilter !== 'All') queryParams.set('status', statusFilter);
  if (candidateFilter.trim()) queryParams.set('candidateName', candidateFilter.trim());
  if (dateFrom) queryParams.set('dateFrom', dateFrom);
  if (dateTo) queryParams.set('dateTo', dateTo);
  queryParams.set('page', String(page));
  queryParams.set('limit', String(PAGE_SIZE));

  const { data, isLoading } = useQuery<TaskListResponse>({
    queryKey: ['interviewSupportTasks', statusFilter, candidateFilter, dateFrom, dateTo, page],
    queryFn: async () => {
      const res = await authFetch(`${API_URL}/api/admin/interview-support/tasks?${queryParams}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load tasks');
      return json;
    },
  });

  const tasks = data?.tasks ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleFilterChange = () => setPage(1);

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <CardTitle className="text-base">All Interview Support Tasks</CardTitle>
            <Badge variant="secondary">{total} total</Badge>
          </div>
          {/* Filter bar */}
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <Select
              value={statusFilter}
              onValueChange={(v) => { setStatusFilter(v); handleFilterChange(); }}
            >
              <SelectTrigger className="w-36 h-8 text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Candidate name…"
              value={candidateFilter}
              onChange={(e) => { setCandidateFilter(e.target.value); handleFilterChange(); }}
              className="w-44 h-8 text-sm"
            />
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); handleFilterChange(); }}
              className="w-36 h-8 text-sm"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); handleFilterChange(); }}
              className="w-36 h-8 text-sm"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs uppercase tracking-wider">Candidate</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Technology</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">End Client</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Round</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Interview Date/Time</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Assigned To</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Received</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : tasks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
                      No tasks found
                    </TableCell>
                  </TableRow>
                ) : (
                  tasks.map((task) => (
                    <TableRow key={task._id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-medium text-sm">{task.candidateName}</TableCell>
                      <TableCell className="text-sm">{task.technology}</TableCell>
                      <TableCell className="text-sm">{task.endClient}</TableCell>
                      <TableCell className="text-sm">{task.round}</TableCell>
                      <TableCell className="text-sm text-nowrap">
                        {task.interviewDateTime
                          ? new Date(task.interviewDateTime).toLocaleString()
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${statusBadgeClass(task.status)}`}>
                          {task.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{task.assignedTo || '—'}</TableCell>
                      <TableCell className="text-sm text-nowrap text-muted-foreground">
                        {task.receivedAt ? new Date(task.receivedAt).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setDetailTaskId(task._id)}
                        >
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-border">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      aria-disabled={page === 1}
                      className={page === 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="text-sm text-muted-foreground px-3">
                      Page {page} of {totalPages}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      aria-disabled={page === totalPages}
                      className={page === totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>

      <InterviewSupportTaskDetail
        taskId={detailTaskId}
        onClose={() => setDetailTaskId(null)}
      />
    </>
  );
}
