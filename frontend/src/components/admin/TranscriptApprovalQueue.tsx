import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_URL, useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

type TranscriptRequestStatus = 'pending' | 'approved' | 'rejected';
type TranscriptRequestFilter = TranscriptRequestStatus | 'all';

interface TranscriptApprovalRequest {
  id: string;
  taskId: string;
  taskSubject: string;
  transcriptTitle: string;
  candidateName: string;
  interviewDate: string;
  interviewRound: string;
  requestedBy: string;
  requesterRole: string;
  requestedAt: string;
  status: TranscriptRequestStatus;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
}

const statusBadgeVariant = (status: TranscriptRequestStatus) => {
  if (status === 'approved') return 'default';
  if (status === 'rejected') return 'destructive';
  return 'secondary';
};

export function TranscriptApprovalQueue() {
  const { authFetch } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState<TranscriptApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<TranscriptRequestFilter>('pending');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const loadRequests = useCallback(async () => {
    setLoading(true);

    try {
      const query = statusFilter === 'all' ? '' : `?status=${statusFilter}`;
      const response = await authFetch(`${API_URL}/api/transcript-requests${query}`);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to load transcript requests.');
      }

      const rows = Array.isArray(payload?.requests) ? payload.requests : [];
      setRequests(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load transcript requests.';
      toast({
        title: 'Failed to load transcript requests',
        description: message,
        variant: 'destructive'
      });
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [API_URL, authFetch, statusFilter, toast]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const handleReviewRequest = useCallback(async (requestId: string, action: 'approve' | 'reject') => {
    setActionLoading((prev) => ({ ...prev, [requestId]: true }));
    try {
      const response = await authFetch(`${API_URL}/api/transcript-requests/${requestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to update transcript request.');
      }

      const updated = payload?.request;
      if (updated?.id) {
        setRequests((prev) => {
          const next = prev.map((row) => (row.id === updated.id ? updated : row));
          if (statusFilter === 'pending') {
            return next.filter((row) => row.status === 'pending');
          }
          return next;
        });
      }

      toast({
        title: action === 'approve' ? 'Transcript request approved' : 'Transcript request rejected'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update transcript request.';
      toast({
        title: 'Transcript review failed',
        description: message,
        variant: 'destructive'
      });
    } finally {
      setActionLoading((prev) => ({ ...prev, [requestId]: false }));
    }
  }, [API_URL, authFetch, statusFilter, toast]);

  const requestCountLabel = useMemo(() => {
    if (loading) return 'Loading...';
    return `${requests.length} request${requests.length === 1 ? '' : 's'}`;
  }, [loading, requests.length]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transcript Admin Approval</CardTitle>
        <CardDescription>
          Review transcript access requests from Tasks Today actions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">{requestCountLabel}</span>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as TranscriptRequestFilter)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="all">All statuses</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={loadRequests} disabled={loading}>
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transcript requests for the selected filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Requested At</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((request) => {
                  const isBusy = Boolean(actionLoading[request.id]);
                  return (
                    <TableRow key={request.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{request.candidateName || 'Unknown candidate'}</span>
                          <span className="text-xs text-muted-foreground">
                            {request.interviewRound || 'Round not set'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[340px] truncate">{request.taskSubject || request.transcriptTitle}</TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{request.requestedBy}</span>
                          <span className="text-xs text-muted-foreground">{request.requesterRole || 'unknown role'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {request.requestedAt ? new Date(request.requestedAt).toLocaleString() : 'Unknown'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(request.status)}>{request.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {request.status === 'pending' ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleReviewRequest(request.id, 'approve')}
                              disabled={isBusy}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleReviewRequest(request.id, 'reject')}
                              disabled={isBusy}
                            >
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {request.reviewedBy
                              ? `Reviewed by ${request.reviewedBy}`
                              : 'Reviewed'}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

