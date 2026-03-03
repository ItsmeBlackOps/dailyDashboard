import { useEffect } from 'react';
import { MonitorSmartphone, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useMicrosoftConsent } from '@/contexts/MicrosoftConsentContext';

export function MicrosoftConsentDialog() {
  const { isDialogOpen, closeConsentDialog, needsConsent, checking, error, grant } = useMicrosoftConsent();

  useEffect(() => {
    if (!needsConsent && isDialogOpen) {
      closeConsentDialog();
    }
  }, [needsConsent, isDialogOpen, closeConsentDialog]);

  return (
    <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) closeConsentDialog(); }}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          document.getElementById('teams-grant-btn')?.focus();
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <MonitorSmartphone className="h-5 w-5" />
            <DialogTitle>Microsoft Teams Access Required</DialogTitle>
          </div>
          <DialogDescription>
            Grant consent so this app can create Teams meetings on your behalf.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={closeConsentDialog} disabled={checking}>
            Dismiss
          </Button>
          <Button
            id="teams-grant-btn"
            onClick={() => void grant()}
            disabled={checking}
          >
            {checking ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Checking…
              </>
            ) : (
              'Grant Access'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
