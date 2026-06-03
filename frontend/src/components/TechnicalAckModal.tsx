import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { parseJsonOrThrow } from '@/lib/fetchJson';

interface AckContent { version: number; title: string; sections: string[]; }
interface AckStatus { required: boolean; currentVersion: number; agreedVersion: number; content: AckContent | null; }

export function TechnicalAckModal() {
  const { authFetch } = useAuth();
  const [content, setContent] = useState<AckContent | null>(null);
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${API_URL}/api/users/me/technical-acknowledgment`);
        const data = await parseJsonOrThrow<AckStatus>(res);
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

  const submit = async () => {
    if (!content || !agreed) return;
    setSubmitting(true);
    try {
      const res = await authFetch(`${API_URL}/api/users/me/technical-acknowledgment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: content.version }),
      });
      await parseJsonOrThrow(res);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!content) return null;

  return (
    // onOpenChange is a no-op + outside/escape prevented → the ONLY exit is to
    // agree + submit. If not agreed, it re-shows on the next load.
    <Dialog open={open} onOpenChange={() => { /* agree-only dismissal */ }}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>{content.title}</DialogTitle></DialogHeader>
        <ul className="list-disc pl-5 space-y-2 text-sm">
          {content.sections.map((s, i) => <li key={i}>{s}</li>)}
        </ul>
        <label className="flex items-center gap-2 text-sm mt-2">
          <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(Boolean(v))} />
          I have read and agree
        </label>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!agreed || submitting}>
            {submitting ? 'Submitting…' : 'I agree & Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
