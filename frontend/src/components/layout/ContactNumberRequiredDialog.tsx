import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUserProfile, formatPhoneDraft, formatPhoneCanonical } from '@/contexts/UserProfileContext';
import { useToast } from '@/hooks/use-toast';

export function ContactNumberRequiredDialog() {
  const { profile, saving, updateProfile } = useUserProfile();
  const { toast } = useToast();
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isOpen = Boolean(
    profile?.requiresContactNumber &&
    !profile?.requiresRoleDetailSelection // let role dialog go first
  );

  const canonical = formatPhoneCanonical(phone);
  const canSubmit = Boolean(canonical);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhoneDraft(e.target.value));
  };

  const handleSave = async () => {
    if (!profile || !canSubmit) return;
    setSubmitting(true);
    try {
      await updateProfile({
        displayName: profile.displayName,
        jobRole: profile.jobRole,
        phoneNumber: phone,
      });
    } catch {
      // toast already shown by updateProfile
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent
        className="[&>button]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Contact Number Required</DialogTitle>
          <DialogDescription>
            Please provide your US contact number. This is mandatory to continue.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="contact-number-input">Phone number</Label>
          <Input
            id="contact-number-input"
            placeholder="+1 (555) 123-4567"
            value={phone}
            onChange={handleChange}
            disabled={saving || submitting}
            autoFocus
          />
          {phone && !canonical && (
            <p className="text-sm text-destructive">
              Enter a valid 10-digit US phone number.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" onClick={handleSave} disabled={!canSubmit || saving || submitting}>
            {saving || submitting ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
