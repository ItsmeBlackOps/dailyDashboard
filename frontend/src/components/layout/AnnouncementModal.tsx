import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/context/NotificationContext';

// Shows notifications flagged `popup` as a front-and-centre modal (not just a
// bell item) until acknowledged. One at a time; dismissing it (button, X, esc,
// or backdrop) marks it read so it won't reappear. Important announcements
// reach people who never open the bell.
export function AnnouncementModal() {
  const { notifications, markAsRead } = useNotifications();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const announcement = useMemo(
    () => notifications.find((n) => n.popup && !n.read) || null,
    [notifications],
  );

  if (!announcement) return null;

  const actorLabel =
    typeof announcement.actor === 'string'
      ? announcement.actor
      : (announcement.actor as any)?.name || '';

  const ack = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await markAsRead(announcement.id);
    } finally {
      setBusy(false);
    }
  };

  const goAndAck = async () => {
    const link = announcement.link;
    await ack();
    if (link) navigate(link);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) void ack(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{announcement.title}</DialogTitle>
          {actorLabel && (
            <DialogDescription className="text-xs uppercase tracking-wide">
              From {actorLabel}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="whitespace-pre-line text-sm leading-relaxed text-foreground">
          {announcement.description}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {announcement.link ? (
            <>
              <Button variant="outline" onClick={ack} disabled={busy}>
                Dismiss
              </Button>
              <Button onClick={goAndAck} disabled={busy}>
                Take me there
              </Button>
            </>
          ) : (
            <Button onClick={ack} disabled={busy}>
              {busy ? 'Saving…' : 'Got it'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
