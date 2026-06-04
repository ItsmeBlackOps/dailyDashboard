import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { parseJsonOrThrow } from '@/lib/fetchJson';

interface WarnMeeting { candidate?: string; scheduledEst?: string }
interface WarnContent { title: string; body: string[]; meetings: WarnMeeting[] }
interface WarnStatus { required: boolean; shownCount: number; maxShows: number; content: WarnContent | null }

// One-shot warning for experts who marked meetings "started" >60 min early.
// Mirrors TechnicalAckModal: fetch on mount, show when required, single
// "I understand" → PATCH (increments the server-side shownCount) → close.
// Re-shows on the next load until maxShows dismissals, then disappears.
export function MeetingStartWarningModal() {
  const { authFetch } = useAuth();
  const [content, setContent] = useState<WarnContent | null>(null);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${API_URL}/api/users/me/meeting-start-warning`);
        const data = await parseJsonOrThrow<WarnStatus>(res);
        if (!cancelled && data.required && data.content) {
          setContent(data.content);
          setOpen(true);
        }
      } catch {
        // Non-blocking: if the status check fails, don't surface the modal.
      }
    })();
    return () => { cancelled = true; };
  }, [authFetch]);

  const acknowledge = async () => {
    setSubmitting(true);
    try {
      const res = await authFetch(`${API_URL}/api/users/me/meeting-start-warning`, { method: 'PATCH' });
      await parseJsonOrThrow(res);
    } catch {
      // Close anyway; it re-shows on the next load if still required.
    } finally {
      setSubmitting(false);
      setOpen(false);
      setContent(null); // fully unmount; re-fetched (and re-shown if still required) on the next load
    }
  };

  if (!content) return null;

  return (
    // Acknowledge-only dismissal: outside/escape are prevented so the only exit
    // is the "I understand" button (which records the dismissal).
    <Dialog open={open} onOpenChange={() => { /* acknowledge-only */ }}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>{content.title}</DialogTitle></DialogHeader>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          {content.body.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
        {content.meetings.length > 0 && (
          <div className="mt-2 rounded-md border bg-muted/40 p-3 text-xs">
            <p className="mb-1 font-medium text-foreground">Meetings affected</p>
            <ul className="space-y-1">
              {content.meetings.map((m, i) => (
                <li key={i}>{m.candidate || 'Candidate'}{m.scheduledEst ? ` — scheduled ${m.scheduledEst}` : ''}</li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button onClick={() => void acknowledge()} disabled={submitting}>
            {submitting ? 'Saving…' : 'I understand'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
