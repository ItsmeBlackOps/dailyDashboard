import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { useGraphMailToken } from '@/hooks/useGraphMailToken';
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
import { Loader2, Lock, Mail } from 'lucide-react';
import type { CandidateAttachment } from '@/components/candidates/AttachmentZone';

/** Server-built preview of the assignment email (Task 4 endpoint). */
interface AssignmentEmailPreview {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  attachments: { id: string; filename: string }[];
}

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
  const { acquireGraphAccessToken } = useGraphMailToken();
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

  // Server-accurate preview (recipients + body + attachment filenames).
  const [preview, setPreview] = useState<AssignmentEmailPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Monotonic request id: out-of-order responses (a slow earlier fetch
  // resolving after a faster later one) must not clobber the latest state.
  const previewRequestId = useRef(0);

  // Reset transient state every time the modal re-opens so it
  // doesn't carry over an aborted draft.
  useEffect(() => {
    if (open) {
      setSubject(defaultSubject);
      setAppendBody('');
      setSelectedAttachmentIds(new Set(attachments.map((a) => a.id)));
      setPreview(null);
      setPreviewError(null);
    }
  }, [open, defaultSubject, attachments]);

  const fetchPreview = useCallback(
    async (
      draft: { subject: string; appendBody: string; attachmentIds: string[] },
      signal: AbortSignal,
    ) => {
      const requestId = ++previewRequestId.current;
      setPreviewLoading(true);
      try {
        const resp = await authFetch(
          `${API_URL}/api/candidates/${candidateId}/assignment-email/preview`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subject: draft.subject.trim() || undefined,
              appendBody: draft.appendBody.trim() || undefined,
              attachmentIds: draft.attachmentIds,
            }),
            signal,
          },
        );
        const json = await resp.json().catch(() => ({}));
        // Ignore stale responses — only the latest request may update state.
        if (requestId !== previewRequestId.current) return;
        if (!resp.ok || !json.success || !json.preview) {
          setPreview(null);
          setPreviewError(json.error || 'Unable to build the email preview.');
          return;
        }
        setPreview(json.preview as AssignmentEmailPreview);
        setPreviewError(null);
      } catch (err) {
        if (signal.aborted || requestId !== previewRequestId.current) return;
        setPreview(null);
        setPreviewError(
          err instanceof Error ? err.message : 'Unable to build the email preview.',
        );
      } finally {
        if (requestId === previewRequestId.current) setPreviewLoading(false);
      }
    },
    [authFetch, candidateId],
  );

  // Refetch the preview on open and whenever the draft changes, debounced
  // ~300ms so keystrokes in subject/notes don't spam the endpoint.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const attachmentIds = Array.from(selectedAttachmentIds);
    const handle = setTimeout(() => {
      void fetchPreview({ subject, appendBody, attachmentIds }, controller.signal);
    }, 300);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [open, subject, appendBody, selectedAttachmentIds, fetchPreview]);

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
    !previewError &&
    Boolean(recruiterEmail) &&
    Boolean(teamLeadEmail) &&
    selectedAttachmentIds.size > 0 &&
    subject.trim().length > 0;

  // Sanitize the server-built HTML before injecting — matches the repo's
  // existing email-body rendering (TasksToday/emailSignature use the same
  // DOMPurify html profile).
  const sanitizedBodyHtml = useMemo(
    () =>
      preview?.bodyHtml
        ? DOMPurify.sanitize(preview.bodyHtml, { USE_PROFILES: { html: true } })
        : '',
    [preview?.bodyHtml],
  );

  // Send from the requester's own mailbox via Microsoft Graph — the SAME
  // delegated path Interview/Assessment Support use. We acquire a Graph token
  // in the browser and pass it as `x-graph-access-token`; the backend calls
  // graphMailService.sendDelegatedMail (→ /me/sendMail). This needs NO app
  // "from" mailbox. If delegated delivery fails server-side it still falls
  // back to the durable outbox, but the normal path is an immediate send.
  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      let graphToken = '';
      try {
        graphToken = await acquireGraphAccessToken();
      } catch {
        toast({
          title: 'Mailbox permission needed',
          description: 'Could not get permission to send from your mailbox. Please try again and approve the Microsoft sign-in prompt.',
          variant: 'destructive',
        });
        setSending(false);
        return;
      }

      const body = {
        subject: subject.trim(),
        appendBody: appendBody.trim() || undefined,
        attachmentIds: Array.from(selectedAttachmentIds),
      };
      const resp = await authFetch(
        `${API_URL}/api/candidates/${candidateId}/send-assignment-email`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-graph-access-token': graphToken },
          body: JSON.stringify(body),
        },
      );
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok || !json.success) {
        throw new Error(json.error || 'Send failed');
      }
      // 200 = sent immediately from the user's mailbox; 202 = queued fallback.
      if (json.status === 'sent') {
        toast({ title: 'Assignment email sent', description: 'Sent from your mailbox.' });
      } else {
        toast({
          title: 'Assignment email queued',
          description: 'The dispatcher will deliver it shortly.',
        });
      }
      onSent?.();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to send';
      toast({ title: 'Send failed', description: message, variant: 'destructive' });
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
            This is exactly what will be sent — recipients, attachments and body are
            built server-side. On submit, the email is queued in the outbox and dispatched
            in the background. "From" address is the configured shared sender, not your mailbox.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          {/* Server-built preview: recipients, attachments and body. */}
          {previewError ? (
            <div
              className="rounded border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive"
              role="alert"
            >
              {DOMPurify.sanitize(previewError)}
            </div>
          ) : !preview && previewLoading ? (
            <div className="flex items-center gap-2 rounded border p-3 bg-muted/30 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Building preview…
            </div>
          ) : preview ? (
            <div className="space-y-2 rounded border p-3 bg-muted/30 text-xs">
              <div>
                <span className="text-muted-foreground">To: </span>
                <span className="font-medium">
                  {preview.to.length ? preview.to.join(', ') : '(none)'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground">CC: </span>
                {preview.cc.length === 0 ? (
                  <span className="text-muted-foreground">(none)</span>
                ) : (
                  preview.cc.map((addr) => {
                    const isPermanent =
                      addr.toLowerCase() === PERMANENT_CC_LABEL.toLowerCase();
                    return isPermanent ? (
                      <span
                        key={addr}
                        className="rounded bg-amber-100 text-amber-900 px-2 py-0.5 inline-flex items-center gap-1"
                        title="Permanent CC — re-injected by the server on every send."
                        aria-label={`Locked permanent CC: ${addr}`}
                      >
                        <Lock className="h-3 w-3" aria-hidden="true" /> {addr}
                      </span>
                    ) : (
                      <span key={addr} className="rounded bg-secondary px-2 py-0.5">
                        {addr}
                      </span>
                    );
                  })
                )}
              </div>
              {preview.bcc.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">BCC: </span>
                  {preview.bcc.map((addr) => (
                    <span key={addr} className="rounded bg-secondary px-2 py-0.5">
                      {addr}
                    </span>
                  ))}
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Attachments: </span>
                {preview.attachments.length === 0 ? (
                  <span className="text-muted-foreground">(none)</span>
                ) : (
                  <span className="font-medium">
                    {preview.attachments.map((a) => a.filename).join(', ')}
                  </span>
                )}
              </div>
            </div>
          ) : null}

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
              Preamble (optional, appears above the template body)
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

          {/* Body preview (read-only, server-rendered HTML). */}
          <div className="space-y-1">
            <Label>Email body preview</Label>
            {previewError ? (
              <div
                className="rounded border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive"
                role="alert"
              >
                {DOMPurify.sanitize(previewError)}
              </div>
            ) : !preview && previewLoading ? (
              <div className="flex items-center gap-2 rounded border p-3 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Building preview…
              </div>
            ) : preview ? (
              <div
                className="max-w-none rounded border border-slate-200 bg-white text-slate-900 p-3 max-h-64 overflow-y-auto text-xs leading-relaxed [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5 [&_a]:text-blue-700 [&_a]:underline [&_hr]:my-2 [&_hr]:border-slate-200"
                aria-label="Assignment email body preview"
                dangerouslySetInnerHTML={{ __html: sanitizedBodyHtml }}
              />
            ) : (
              <p className="text-xs text-muted-foreground italic">
                Preview unavailable.
              </p>
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
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
