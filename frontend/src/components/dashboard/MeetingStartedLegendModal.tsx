import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Circle } from 'lucide-react';

const SEEN_KEY = 'prt.seenMeetingStartedLegend';

export function MeetingStartedLegendModal() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { if (!localStorage.getItem(SEEN_KEY)) setOpen(true); } catch { /* ignore */ }
  }, []);
  const dismiss = () => {
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Meeting status indicator</DialogTitle></DialogHeader>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-500" aria-hidden="true" /> = meeting has started</div>
          <div className="flex items-center gap-2"><Circle className="h-5 w-5 text-muted-foreground" aria-hidden="true" /> = not started yet</div>
          <p className="text-muted-foreground">If you run the meeting, click the grey circle in a row to mark it started.</p>
        </div>
        <DialogFooter><Button onClick={dismiss}>Got it</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
