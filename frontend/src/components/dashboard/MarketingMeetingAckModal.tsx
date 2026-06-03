import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, Circle } from 'lucide-react';
import { useAuth, API_URL } from '@/hooks/useAuth';
import { parseJsonOrThrow } from '@/lib/fetchJson';

interface AckStatus { required: boolean; currentVersion: number; agreedVersion: number; }

export function MarketingMeetingAckModal() {
  const { authFetch } = useAuth();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState<number | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${API_URL}/api/users/me/marketing-meeting-acknowledgment`);
        const data = await parseJsonOrThrow<AckStatus>(res);
        if (!cancelled && data.required) { setVersion(data.currentVersion); setOpen(true); }
      } catch { /* non-blocking */ }
    })();
    return () => { cancelled = true; };
  }, [authFetch]);

  const submit = async () => {
    if (version == null || !agreed) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await authFetch(`${API_URL}/api/users/me/marketing-meeting-acknowledgment`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }),
      });
      await parseJsonOrThrow(res);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record your acknowledgment');
    } finally { setSubmitting(false); }
  };

  if (version == null) return null;

  return (
    <Dialog open={open} onOpenChange={() => { /* agree-only */ }}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader><DialogTitle>Meeting status indicator</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p>On Tasks Today, each meeting shows a small status mark:</p>
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" aria-hidden="true" />
            <span><strong>Green</strong> — the meeting has <strong>started</strong> (the expert joined). Hover the green mark to see exactly when they joined (EST).</span>
          </div>
          <div className="flex items-start gap-2">
            <Circle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
            <span><strong>Grey</strong> — the meeting has <strong>not started</strong> yet.</span>
          </div>
          <label className="flex items-center gap-2 pt-1">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(Boolean(v))} />
            I acknowledge
          </label>
          {error && <p className="text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={!agreed || submitting}>
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
