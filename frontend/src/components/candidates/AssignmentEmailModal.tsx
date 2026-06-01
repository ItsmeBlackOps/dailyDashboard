import { useEffect, useMemo, useState } from 'react';
import { useAuth, API_URL } from '@/hooks/useAuth';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Lock, Mail } from 'lucide-react';
import type { CandidateAttachment } from '@/components/candidates/AttachmentZone';

// PRT Phase 3 — Assignment Email composer.
//
// Server is source of truth for recipients (permanent CC injected
// server-side regardless of what the UI sent). The "locked chip" here
// is decorative; users cannot remove it client-side.
const PERMANENT_CC_LABEL = 'Tushar.ahuja@silverspaceinc.com';

interface AssignmentEmailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateId: string;
  candidateName: string;
  technology?: string | null;
  visaType?: string | null;
  recruiterEmail?: string | null;
  teamLeadEmail?: string | null;
  attachments: CandidateAttachment[];
  /** Called after a successful send so the parent can refresh. */
  onSent?: () => void;
}

export default function AssignmentEmailModal({
  open,
  onOpenChange,
  candidateId,
  candidateName,
  technology,
  visaType,
  recruiterEmail,
  teamLeadEmail,
  attachments,
  onSent,
}: AssignmentEmailModalProps) {
  const { authFetch } = useAuth();
  const { toast } = useToast();

  const defaultSubject = useMemo(
    () => `Assignment: ${candidateName} – ${technology || '—'} – ${visaType || '—'}`,
    [candidateName, technology, visaType],
  );

  const [subject, setSubject] = useState(defaultSubject);
  const [appendBody, setAppendBody] = useState('');
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<Set<string>>(
    () => new Set(attachments.map((a) => a.id)),
  );
  const [sending, setSending] = useState(false);

  // Reset transient state every time the modal re-opens so it
  // doesn't carry over an aborted draft.
  useEffect(() => {
    if (open) {
      setSubject(defaultSubject);
      setAppendBody('');
      setSelectedAttachmentIds(new Set(attachments.map((a) => a.id)));
    }
  }, [open, defaultSubject, attachments]);

  const toggleAttachment = (id: string) => {
    setSelectedAttachmentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const canSend =
    !sending &&
    Boolean(recruiterEmail) &&
    Boolean(teamLeadEmail) &&
    selectedAttachmentIds.size > 0 &&
    subject.trim().length > 0;

  // Phase 3.5 — enqueue-mode. The server queues the send into the
  // EmailOutbox and the worker dispatches via app-only Graph. No MSAL
  // token is acquired from the browser; "From" becomes the configured
  // app sender (deliberate trade-off for durable retry over 24h).
  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const body = {
        subject: subject.trim(),
        appendBody: appendBody.trim() || undefined,
        attachmentIds: Array.from(selectedAttachmentIds),
      };
      const resp = await authFetch(
        `${API_URL}/api/candidates/${candidateId}/send-assignment-email`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json = await resp.json().catch(() => ({}));
      // 202 Accepted is the happy path now.
      if (!resp.ok || !json.success) {
        throw new Error(json.error || 'Queue failed');
      }
      toast({
        title: 'Assignment email queued',
        description: 'The dispatcher will send it shortly. Refresh the page in a few minutes to see the confirmation.',
      });
      onSent?.();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to queue';
      toast({ title: 'Queue failed', description: message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Send Assignment Email
          </DialogTitle>
          <DialogDescription>
            The body uses the standard PRD §6.2 template (tokens replaced server-side).
            On submit, the email is queued in the outbox and dispatched in the background.
            "From" address is the configured shared sender, not your mailbox.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          {/* Recipients summary (server is source of truth) */}
          <div className="space-y-2 rounded border p-3 bg-muted/30 text-xs">
            <div>
              <span className="text-muted-foreground">To: </span>
              <span className="font-medium">{recruiterEmail || '(no recruiter)'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">CC: </span>
              {teamLeadEmail && (
                <span className="rounded bg-secondary px-2 py-0.5">{teamLeadEmail}</span>
              )}
              <span className="rounded bg-secondary px-2 py-0.5">{'(recruiter\'s manager — resolved server-side)'}</span>
              <span
                className="rounded bg-amber-100 text-amber-900 px-2 py-0.5 inline-flex items-center gap-1"
                title="Permanent CC — re-injected by the server on every send."
                aria-label={`Locked permanent CC: ${PERMANENT_CC_LABEL}`}
              >
                <Lock className="h-3 w-3" aria-hidden="true" /> {PERMANENT_CC_LABEL}
              </span>
            </div>
          </div>

          {/* Subject */}
          <div className="space-y-1">
            <Label htmlFor="ae-subject">Subject</Label>
            <Input
              id="ae-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={sending}
              placeholder="Assignment: Candidate Name – Technology – Visa Type"
            />
          </div>

          {/* Append body */}
          <div className="space-y-1">
            <Label htmlFor="ae-append">
              Preamble (optional, appears above the standard template)
            </Label>
            <Textarea
              id="ae-append"
              value={appendBody}
              onChange={(e) => setAppendBody(e.target.value)}
              disabled={sending}
              rows={3}
              placeholder="Add a short note before the template if needed."
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground text-right">
              {appendBody.length} / 2000
            </p>
          </div>

          {/* Attachments */}
          <div className="space-y-1">
            <Label>Attachments</Label>
            {attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No attachments on this candidate. At least one is required.
              </p>
            ) : (
              <ul className="rounded border divide-y">
                {attachments.map((att) => {
                  const checked = selectedAttachmentIds.has(att.id);
                  return (
                    <li
                      key={att.id}
                      className="flex items-center gap-2 p-2 text-xs"
                    >
                      <Checkbox
                        id={`ae-att-${att.id}`}
                        checked={checked}
                        onCheckedChange={() => toggleAttachment(att.id)}
                        disabled={sending}
                      />
                      <label
                        htmlFor={`ae-att-${att.id}`}
                        className="flex-1 cursor-pointer truncate"
                      >
                        {att.filename}{' '}
                        <span className="text-muted-foreground">({att.mimeType})</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSend} disabled={!canSend}>
            {sending ? 'Queueing…' : 'Queue & Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
