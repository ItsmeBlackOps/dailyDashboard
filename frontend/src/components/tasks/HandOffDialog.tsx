// "Hand off to teammate" — launched from a task's Actions menu on Tasks
// Today. Creates a tasks-scope delegation for the selected task (plus,
// optionally, more of the owner's tasks from the same list). Expert-
// authored hand-offs land pending with their team lead; a lead doing it
// for their own report applies immediately — the toast reflects which.

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { deriveDisplayNameFromEmail } from '@/utils/userNames';
import { fetchEligible, grantDelegation, type EligiblePerson } from '@/lib/delegationApi';

export interface HandOffTask {
  taskId: string;
  subject: string;
}

interface HandOffDialogProps {
  open: boolean;
  /** The task the action was launched from. */
  task: HandOffTask | null;
  /** The owner's OTHER tasks in the current list — offered as add-ons. */
  myOtherTasks?: HandOffTask[];
  onClose: () => void;
  onDone?: () => void;
}

const nameOf = (email: string) => deriveDisplayNameFromEmail(email) || email;

export function HandOffDialog({ open, task, myOtherTasks = [], onClose, onDone }: HandOffDialogProps) {
  const { authFetch } = useAuth();
  const { toast } = useToast();

  const [delegates, setDelegates] = useState<EligiblePerson[]>([]);
  const [teammate, setTeammate] = useState('');
  const [extraIds, setExtraIds] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);

  // Reset is keyed on `open` ALONE — bundling it with the fetch effect
  // (whose authFetch identity can change per render) re-seeds new Set()
  // state every cycle and loops the render.
  useEffect(() => {
    if (!open) return;
    setTeammate('');
    setExtraIds(new Set());
    setReason('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchEligible(authFetch, API_URL)
      .then((e) => { if (!cancelled) setDelegates(e.delegates || []); })
      .catch(() => { if (!cancelled) setDelegates([]); });
    return () => { cancelled = true; };
  }, [open, authFetch]);

  const taskCount = 1 + extraIds.size;
  const summary = useMemo(() => {
    if (!teammate || !task) return '';
    return `${nameOf(teammate)} will cover ${taskCount === 1 ? 'this task' : `${taskCount} of your tasks`} until they end — your team lead is asked to approve if required.`;
  }, [teammate, task, taskCount]);

  const toggleExtra = (id: string) => {
    setExtraIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async () => {
    if (!task) return;
    if (!teammate) {
      toast({ title: 'Pick a teammate', variant: 'destructive' });
      return;
    }
    setSending(true);
    try {
      const result = await grantDelegation(authFetch, API_URL, {
        delegateEmail: teammate,
        scope: 'tasks',
        taskIds: [task.taskId, ...extraIds],
        reason: reason.trim() || undefined,
      });
      const pending = result?.delegation?.status === 'pending';
      toast({
        title: pending ? 'Hand-off sent for approval' : 'Hand-off active',
        description: pending
          ? `Your team lead has been notified — ${nameOf(teammate)} covers once they approve.`
          : `${nameOf(teammate)} now covers ${taskCount === 1 ? 'the task' : `${taskCount} tasks`}.`,
      });
      onClose();
      onDone?.();
    } catch (err) {
      toast({ title: 'Hand-off failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Hand off to a teammate</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground truncate" title={task?.subject}>
            {task?.subject}
          </p>

          <div>
            <Label className="text-xs">Who covers it?</Label>
            <Select value={teammate || undefined} onValueChange={setTeammate}>
              <SelectTrigger aria-label="Teammate">
                <SelectValue placeholder="Pick a teammate" />
              </SelectTrigger>
              <SelectContent>
                {delegates.map((p) => (
                  <SelectItem key={p.email} value={p.email}>
                    {nameOf(p.email)}
                    {p.teamLead ? ` — under ${p.teamLead}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {delegates.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">No eligible teammates found.</p>
            )}
          </div>

          {myOtherTasks.length > 0 && (
            <div>
              <Label className="text-xs">Also include (optional)</Label>
              <div className="mt-1 max-h-36 space-y-1.5 overflow-y-auto rounded-md border p-2">
                {myOtherTasks.slice(0, 9).map((t) => (
                  <label key={t.taskId} className="flex cursor-pointer items-start gap-2 text-xs">
                    <Checkbox
                      checked={extraIds.has(t.taskId)}
                      onCheckedChange={() => toggleExtra(t.taskId)}
                      aria-label={t.subject}
                    />
                    <span className="min-w-0 truncate">{t.subject}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs">Reason (optional)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="double-booked, leaving early…" />
          </div>

          {summary && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-foreground/80">{summary}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={sending || !teammate}>
            {sending ? 'Sending…' : 'Hand off'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default HandOffDialog;
