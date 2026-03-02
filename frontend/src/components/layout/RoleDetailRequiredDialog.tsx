import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUserProfile } from '@/contexts/UserProfileContext';

const DEFAULT_ROLE_OPTIONS = ['DATA', 'DEVELOPER', 'DEVOPS'];

export function RoleDetailRequiredDialog() {
  const { profile, saving, updateProfile } = useUserProfile();
  const [selectedRoleDetail, setSelectedRoleDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const userRole = (localStorage.getItem('role') || '').trim().toLowerCase();
  const isUserRole = userRole === 'user';
  const requiresSelection = Boolean(isUserRole && profile?.requiresRoleDetailSelection);
  const allowedRoleDetails = useMemo(
    () => profile?.allowedRoleDetails?.length ? profile.allowedRoleDetails : DEFAULT_ROLE_OPTIONS,
    [profile?.allowedRoleDetails]
  );

  const currentValue = selectedRoleDetail || profile?.jobRole || '';
  const canSubmit = Boolean(currentValue && allowedRoleDetails.includes(currentValue));

  const handleSave = async () => {
    if (!profile || !canSubmit) return;
    setSubmitting(true);
    try {
      await updateProfile({
        displayName: profile.displayName,
        phoneNumber: profile.phoneNumber,
        jobRole: currentValue
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={requiresSelection} onOpenChange={() => {}}>
      <DialogContent
        className="[&>button]:hidden"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Select Your Role Detail</DialogTitle>
          <DialogDescription>
            Select the most relevant role you are working for. This is mandatory.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="role-detail-select">Role detail</Label>
          <Select
            value={currentValue}
            onValueChange={setSelectedRoleDetail}
            disabled={saving || submitting}
          >
            <SelectTrigger id="role-detail-select">
              <SelectValue placeholder="Select role detail" />
            </SelectTrigger>
            <SelectContent>
              {allowedRoleDetails.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

