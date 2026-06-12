import { useMemo, useRef, useState } from 'react';
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

const POPUP_VIEW_CAP = 3;

// Shows notifications flagged `popup` as a front-and-centre modal (not just a
// bell item). It pops up to POPUP_VIEW_CAP (3) times per user across loads,
// then stops on its own: each dismissal records a view; when the cap is hit the
// backend also marks it read so it clears the bell too. A session guard keeps
// it from immediately re-popping after a dismissal within the same session.
export function AnnouncementModal() {
  const { notifications, markAsRead, recordPopupView } = useNotifications();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const dismissedThisSession = useRef<Set<string>>(new Set());
  const [, force] = useState(0);

  const announcement = useMemo(
    () =>
      notifications.find(
        (n) => n.popup && !n.read && (n.popupViews || 0) < POPUP_VIEW_CAP && !dismissedThisSession.current.has(n.id),
      ) || null,
    [notifications],
  );

  if (!announcement) return null;

  const actorLabel =
    typeof announcement.actor === 'string'
      ? announcement.actor
      : (announcement.actor as any)?.name || '';

  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    dismissedThisSession.current.add(announcement.id);
    try {
      const views = await recordPopupView(announcement.id);
      if (views >= POPUP_VIEW_CAP) {
        await markAsRead(announcement.id);
      }
    } finally {
      setBusy(false);
      force((n) => n + 1); // re-evaluate (close, or advance to the next announcement)
    }
  };

  const goAndDismiss = async () => {
    const link = announcement.link;
    await dismiss();
    if (link) navigate(link);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) void dismiss(); }}>
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
              <Button variant="outline" onClick={dismiss} disabled={busy}>
                Dismiss
              </Button>
              <Button onClick={goAndDismiss} disabled={busy}>
                Take me there
              </Button>
            </>
          ) : (
            <Button onClick={dismiss} disabled={busy}>
              {busy ? 'Saving…' : 'Got it'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
