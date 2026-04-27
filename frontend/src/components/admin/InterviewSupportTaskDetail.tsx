import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { useAuth, API_URL } from '@/hooks/useAuth';

export interface AuditLog {
  _id: string;
  action: string;
  performedBy: string;
  timestamp: string;
  details?: string;
}

export interface TaskReply {
  _id: string;
  from: string;
  body: string;
  receivedAt: string;
}

export interface InterviewSupportTask {
  _id: string;
  candidateName: string;
  technology: string;
  endClient: string;
  round: string;
  interviewDateTime: string;
  status: string;
  assignedTo?: string;
  receivedAt: string;
  emailSubject?: string;
  emailBody?: string;
  replies: TaskReply[];
  auditLogs: AuditLog[];
}

const TASK_STATUSES = [
  'Pending',
  'Assigned',
  'Acknowledged',
  'Completed',
  'Cancelled',
  'Not Done',
  'Rescheduled',
];

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

interface Props {
  taskId: string | null;
  onClose: () => void;
}

export default function InterviewSupportTaskDetail({ taskId, onClose }: Props) {
  const { authFetch } = useAuth();
  const queryClient = useQueryClient();
  const [newStatus, setNewStatus] = useState('');

  const { data: task, isLoading } = useQuery<InterviewSupportTask>({
    queryKey: ['interviewSupportTask', taskId],
    queryFn: async () => {
      const res = await authFetch(`${API_URL}/api/admin/interview-support/tasks/${taskId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load task');
      return json.task;
    },
    enabled: !!taskId,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await authFetch(
        `${API_URL}/api/admin/interview-support/tasks/${taskId}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to update status');
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interviewSupportTasks'] });
      queryClient.invalidateQueries({ queryKey: ['interviewSupportTask', taskId] });
    },
  });

  const retryAssignMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch(
        `${API_URL}/api/admin/interview-support/tasks/${taskId}/retry-assign`,
        { method: 'POST' }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to retry');
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interviewSupportTasks'] });
      queryClient.invalidateQueries({ queryKey: ['interviewSupportTask', taskId] });
    },
  });

  const canRetry = task && ['Pending', 'Assigned'].includes(task.status);

  return (
    <Sheet open={!!taskId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border">
          <SheetTitle className="text-base">
            {isLoading ? 'Loading…' : task ? `Task: ${task.candidateName}` : 'Task Detail'}
          </SheetTitle>
          {task && (
            <Badge className={`w-fit text-xs ${statusBadgeClass(task.status)}`}>
              {task.status}
            </Badge>
          )}
        </SheetHeader>

        {isLoading && (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Loading task…
          </div>
        )}

        {task && (
          <>
            <div className="flex-1 overflow-hidden">
              <Tabs defaultValue="details" className="h-full flex flex-col">
                <TabsList className="mx-6 mt-4 w-auto self-start">
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="replies">
                    Replies {task.replies.length > 0 && `(${task.replies.length})`}
                  </TabsTrigger>
                  <TabsTrigger value="audit">Audit Trail</TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="flex-1 overflow-hidden mt-0">
                  <ScrollArea className="h-full px-6 py-4">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mb-6">
                      <DetailField label="Candidate Name" value={task.candidateName} />
                      <DetailField label="Technology" value={task.technology} />
                      <DetailField label="End Client" value={task.endClient} />
                      <DetailField label="Round" value={task.round} />
                      <DetailField
                        label="Interview Date/Time"
                        value={task.interviewDateTime ? new Date(task.interviewDateTime).toLocaleString() : '—'}
                      />
                      <DetailField label="Assigned To" value={task.assignedTo || '—'} />
                      <DetailField
                        label="Received At"
                        value={task.receivedAt ? new Date(task.receivedAt).toLocaleString() : '—'}
                      />
                      {task.emailSubject && (
                        <div className="col-span-2">
                          <DetailField label="Email Subject" value={task.emailSubject} />
                        </div>
                      )}
                    </div>
                    {task.emailBody && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                          Email Body
                        </p>
                        <ScrollArea className="h-64 rounded-md border border-border bg-muted/20 p-3">
                          <pre className="text-xs whitespace-pre-wrap font-mono">{task.emailBody}</pre>
                        </ScrollArea>
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="replies" className="flex-1 overflow-hidden mt-0">
                  <ScrollArea className="h-full px-6 py-4">
                    {task.replies.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">No replies yet</p>
                    ) : (
                      <div className="space-y-4">
                        {task.replies.map((reply) => (
                          <div key={reply._id} className="border border-border rounded-lg p-4 bg-card">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium">{reply.from}</span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(reply.receivedAt).toLocaleString()}
                              </span>
                            </div>
                            <pre className="text-xs whitespace-pre-wrap font-mono text-foreground/80">
                              {reply.body}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="audit" className="flex-1 overflow-hidden mt-0">
                  <ScrollArea className="h-full px-6 py-4">
                    {task.auditLogs.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">No audit logs</p>
                    ) : (
                      <div className="relative">
                        <div className="absolute left-2 top-0 bottom-0 w-px bg-border" />
                        <div className="space-y-4 pl-8">
                          {task.auditLogs.map((log) => (
                            <div key={log._id} className="relative">
                              <div className="absolute -left-6 top-1.5 w-2 h-2 rounded-full bg-primary border-2 border-background" />
                              <p className="text-sm font-medium">{log.action}</p>
                              <p className="text-xs text-muted-foreground">{log.performedBy}</p>
                              {log.details && (
                                <p className="text-xs text-foreground/70 mt-0.5">{log.details}</p>
                              )}
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {new Date(log.timestamp).toLocaleString()}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>

            {/* Action bar */}
            <div className="border-t border-border px-6 py-4 flex items-center gap-3 flex-wrap bg-background">
              <Select
                value={newStatus || task.status}
                onValueChange={setNewStatus}
              >
                <SelectTrigger className="w-40 h-8 text-sm">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={updateStatusMutation.isPending || !newStatus || newStatus === task.status}
                onClick={() => newStatus && updateStatusMutation.mutate(newStatus)}
              >
                {updateStatusMutation.isPending ? 'Updating…' : 'Update Status'}
              </Button>

              {canRetry && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" className="ml-auto">
                      Retry Auto-Assign
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Retry Auto-Assign?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will attempt to automatically assign this task again. The current assignment will be overwritten if a match is found.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => retryAssignMutation.mutate()}
                        disabled={retryAssignMutation.isPending}
                      >
                        {retryAssignMutation.isPending ? 'Retrying…' : 'Retry'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}
