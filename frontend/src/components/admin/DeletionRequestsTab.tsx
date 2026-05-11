import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

interface DeletionRequestRow {
  _id: string;
  subject: string;
  candidateName: string;
  interviewDateTime: string | null;
  emailId: string | null;
  from: string;
  deletionRequest: {
    requestedBy: string;
    requestedAt: string;
    reason: string;
    status: 'pending' | 'approved' | 'rejected';
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    rejectionReason?: string | null;
  };
}

interface ListResponse {
  success: boolean;
  requests: DeletionRequestRow[];
}

export default function DeletionRequestsTab() {
  const { authFetch } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; row: DeletionRequestRow | null; reason: string }>({
    open: false, row: null, reason: '',
  });

  const { data, isLoading, refetch, isFetching } = useQuery<ListResponse>({
    queryKey: ['deletionRequests'],
    queryFn: async () => {
      const res = await authFetch(`${API_URL}/api/admin/interview-support/deletion-requests`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load deletion requests');
      return json;
    },
    refetchInterval: 30_000,
  });

  const review = useMutation({
    mutationFn: async (vars: { taskId: string; decision: 'approved' | 'rejected'; rejectionReason?: string }) => {
      const res = await authFetch(`${API_URL}/api/admin/interview-support/tasks/${vars.taskId}/deletion-review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: vars.decision, rejectionReason: vars.rejectionReason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) {
        throw new Error(json.error || `Review failed (${res.status})`);
      }
      return json;
    },
    onSuccess: (_, vars) => {
      toast({
        title: vars.decision === 'approved' ? 'Deletion approved' : 'Deletion rejected',
        description: vars.decision === 'approved'
          ? 'The original email has been removed from the mailbox and the task is soft-deleted.'
          : 'The recruiter will be notified with your reason.',
      });
      queryClient.invalidateQueries({ queryKey: ['deletionRequests'] });
    },
    onError: (err: any) => {
      toast({
        title: 'Review failed',
        description: err?.message || 'Could not complete the review',
        variant: 'destructive',
      });
    },
  });

  const requests = data?.requests || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            Deletion Requests
            {requests.length > 0 && <Badge variant="secondary">{requests.length} pending</Badge>}
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Recruiters request task deletion with a reason. Approving deletes the original email from the shared mailbox via PicaOS and soft-deletes the task.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
        ) : requests.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">No pending deletion requests.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Candidate</TableHead>
                <TableHead>Requester</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((row) => {
                const requested = new Date(row.deletionRequest.requestedAt);
                const reqId = row._id;
                const noEmailId = !row.emailId;
                return (
                  <TableRow key={row._id}>
                    <TableCell className="max-w-[280px] truncate" title={row.subject}>
                      <div className="flex items-center gap-1">
                        {noEmailId && (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" aria-label="no emailId stored — cannot delete from mailbox" />
                        )}
                        <span className="truncate">{row.subject}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{row.candidateName}</TableCell>
                    <TableCell className="text-xs">{row.deletionRequest.requestedBy}</TableCell>
                    <TableCell className="text-xs max-w-[240px]" title={row.deletionRequest.reason}>
                      <div className="line-clamp-2">{row.deletionRequest.reason}</div>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {requested.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="default"
                              disabled={review.isPending}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                              Approve
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Approve deletion?</AlertDialogTitle>
                              <AlertDialogDescription asChild>
                                <div className="space-y-2 text-sm">
                                  <div>
                                    This will call PicaOS to <strong>permanently delete the original email</strong> from
                                    the shared mailbox, then mark the task soft-deleted in the dashboard.
                                  </div>
                                  {noEmailId && (
                                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                                      ⚠ This task has no <code>emailId</code> stored. Approval will fail
                                      with a clear error — use Reject and ask the recruiter to remove
                                      the email manually instead.
                                    </div>
                                  )}
                                </div>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => review.mutate({ taskId: reqId, decision: 'approved' })}
                              >
                                Approve & Delete Email
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={review.isPending}
                          onClick={() => setRejectDialog({ open: true, row, reason: '' })}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Reject
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Reject reason dialog */}
      <Dialog
        open={rejectDialog.open}
        onOpenChange={(open) => setRejectDialog((p) => ({ ...p, open }))}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject deletion request</DialogTitle>
            <DialogDescription>
              The recruiter will see your reason. The task will stay active.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="reject-reason">Reason <span className="text-destructive">*</span></Label>
            <Textarea
              id="reject-reason"
              value={rejectDialog.reason}
              onChange={(e) => setRejectDialog((p) => ({ ...p, reason: e.target.value }))}
              placeholder="Explain why this request is rejected (e.g. task is already in progress, candidate confirmed)"
              className="min-h-[100px] resize-none text-sm"
              autoFocus
            />
          </div>
          <DialogFooter className="sm:justify-between items-center">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRejectDialog({ open: false, row: null, reason: '' })}
              disabled={review.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!rejectDialog.reason.trim() || review.isPending}
              onClick={() => {
                if (!rejectDialog.row) return;
                review.mutate(
                  { taskId: rejectDialog.row._id, decision: 'rejected', rejectionReason: rejectDialog.reason.trim() },
                  { onSuccess: () => setRejectDialog({ open: false, row: null, reason: '' }) },
                );
              }}
            >
              {review.isPending ? 'Submitting…' : 'Reject Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
