import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Building2, ExternalLink, Globe, Menu, Phone, User, UserCog, LogOut, ChevronDown, CheckCircle2, AlertTriangle, Bell, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { API_BASE } from '@/constants';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUserProfile, formatPhoneDraft, formatPhoneCanonical } from '@/contexts/UserProfileContext';
import { useNotifications } from '@/context/NotificationContext';
interface HeaderProps {
  toggleSidebar: () => void;
  openSettings?: () => void; // keep if you plan to use it later
}

import { usePostHog } from 'posthog-js/react';

const DEFAULT_ROLE_OPTIONS = ['DATA', 'DEVELOPER', 'DEVOPS'];

export function Header({ toggleSidebar }: HeaderProps) {
  const { logout } = useAuth();
  const posthog = usePostHog();
  const { profile, loading, saving, updateProfile } = useUserProfile();
  const [editOpen, setEditOpen] = useState(false);
  const [formState, setFormState] = useState({ displayName: '', jobRole: '', phoneNumber: '' });

  const openConsentPopup = useCallback(() => {
    const width = 600;
    const height = 700;
    const specs = `noopener,noreferrer,width=${width},height=${height}`;
    const consentUrl = `${API_BASE}/auth/consent`;
    window.open(consentUrl, 'teams-consent', specs);
  }, []);

  const getStoredValue = useCallback((key: string) => {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  }, []);

  const fallbackEmail = useMemo(() => profile?.email || getStoredValue('email'), [profile?.email, getStoredValue]);
  const storedSystemRole = useMemo(() => (getStoredValue('role') || '').trim().toLowerCase(), [getStoredValue]);
  const isSystemUserRole = storedSystemRole === 'user';
  const allowedRoleDetails = useMemo(
    () => profile?.allowedRoleDetails?.length ? profile.allowedRoleDetails : DEFAULT_ROLE_OPTIONS,
    [profile?.allowedRoleDetails]
  );
  const fallbackDisplayName = useMemo(
    () => profile?.displayName || getStoredValue('displayName') || fallbackEmail.split('@')[0],
    [profile?.displayName, getStoredValue, fallbackEmail]
  );

  useEffect(() => {
    setFormState({
      displayName: profile?.displayName || fallbackDisplayName,
      jobRole: profile?.jobRole || '',
      phoneNumber: profile?.phoneNumber || ''
    });
  }, [profile?.displayName, profile?.jobRole, profile?.phoneNumber, fallbackDisplayName]);

  const initials = useMemo(() => {
    const source = fallbackDisplayName || fallbackEmail;
    if (!source) return 'U';
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      return source.slice(0, 2).toUpperCase();
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }, [fallbackDisplayName, fallbackEmail]);

  const handleFieldChange = (field: 'displayName' | 'jobRole' | 'phoneNumber') => (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    if (field === 'phoneNumber') {
      const draft = formatPhoneDraft(event.target.value);
      setFormState((prev) => ({ ...prev, phoneNumber: draft }));
      return;
    }
    setFormState((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleRoleDetailChange = (value: string) => {
    setFormState((prev) => ({ ...prev, jobRole: value }));
  };

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await updateProfile(formState);
      setEditOpen(false);
    } catch {
      // toast handled in context
    }
  };

  const handleDialogChange = (open: boolean) => {
    if (saving) return;
    setEditOpen(open);
  };

  const handlePhoneBlur = () => {
    const canonical = formatPhoneCanonical(formState.phoneNumber);
    if (canonical) {
      setFormState((prev) => ({ ...prev, phoneNumber: canonical }));
    }
  };

  const { notifications, unreadCount, markAsRead, clearAll, openModal } = useNotifications();
  const navigate = useNavigate();

  const handleNotificationClick = (notif: any) => {
    markAsRead(notif.id);

    if (notif.type === 'comment' || notif.title?.toLowerCase().includes('discussion')) {
      // Navigate to Resume Understanding with discussion param
      if (notif.candidateId) {
        navigate(`/resume-understanding?discussionCandidateId=${notif.candidateId}`);
        return;
      }
    }

    // Default behavior: open modal
    openModal(notif);
  };

  return (
    <header className="glass sticky top-0 z-30 h-16 flex items-center px-3 md:px-4 shadow-sm gap-2">
      <Button onClick={toggleSidebar} variant="ghost" size="icon" aria-label="Toggle sidebar">
        <Menu className="h-5 w-5" />
      </Button>

      <Link to="/dashboard" className="text-lg md:text-xl font-bold">
        Daily Dashboard
      </Link>

      <div className="ml-auto flex items-center gap-2">
        <ThemeToggle />

        {/* Notification Bell */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive"></span>
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Notifications ({unreadCount})</span>
              {unreadCount > 0 && (
                <Button variant="ghost" size="xs" onClick={clearAll} className="h-auto p-1 text-xs text-primary">
                  Mark all read
                </Button>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No new notifications
              </div>
            ) : (
              <div className="max-h-[300px] overflow-y-auto">
                {notifications.map(notif => (
                  <DropdownMenuItem
                    key={notif.id}
                    className={`flex flex-col items-start gap-1 p-3 cursor-pointer ${!notif.read ? 'bg-muted/50' : ''}`}
                    onSelect={(e) => {
                      e.preventDefault();
                      handleNotificationClick(notif);
                    }}
                  >
                    <div className="flex items-start justify-between w-full">
                      <span className="font-semibold text-sm">{notif.title}</span>
                      {!notif.read && <span className="h-2 w-2 rounded-full bg-primary mt-1" />}
                    </div>
                    <span className="text-xs text-muted-foreground line-clamp-2">{notif.description}</span>
                    <span className="text-[10px] text-muted-foreground/70 self-end">
                      {new Date(notif.timestamp).toLocaleTimeString()}
                    </span>
                  </DropdownMenuItem>
                ))}
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button onClick={openConsentPopup} variant="ghost" size="sm">
          <ExternalLink className="h-4 w-4 mr-1" />
          Grant Teams Consent
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="pl-2 pr-3"
              data-tour-id="profile-menu-trigger"
            >
              <Avatar className="h-7 w-7 mr-2">
                <AvatarFallback className="text-xs font-medium bg-primary/10 text-primary">
                  {loading ? '…' : initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden md:inline text-sm font-medium max-w-[140px] truncate">
                {fallbackDisplayName || 'Profile'}
              </span>
              <ChevronDown className="ml-1.5 h-4 w-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Profile</span>
              <Badge variant={profile?.isComplete ? 'default' : 'secondary'} className="gap-1">
                {profile?.isComplete ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Signature ready
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Details needed
                  </>
                )}
              </Badge>
            </DropdownMenuLabel>
            <div className="px-3 pb-2 text-sm space-y-1">
              <p className="font-semibold leading-tight truncate">{fallbackDisplayName || '—'}</p>
              <p className="text-xs text-muted-foreground truncate">
                {profile?.jobRole || 'Add your job role'}
              </p>
            </div>
            {!profile?.isComplete && (
              <div className="px-3 pb-2 text-xs text-muted-foreground">
                Add missing details to include your email signature in support requests.
              </div>
            )}
            <DropdownMenuSeparator />
            <div className="px-3 py-1 space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4" />
                <span className="truncate">{fallbackEmail || '—'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                <span className="truncate">{profile?.companyName || 'Assigned automatically'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                <span className="truncate">{profile?.phoneNumber || 'Add phone number'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                {profile?.companyUrl ? (
                  <a
                    href={profile.companyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate underline-offset-4 hover:underline"
                  >
                    {profile.companyUrl.replace(/^https?:\/\//i, '')}
                  </a>
                ) : (
                  <span className="truncate">Company site pending</span>
                )}
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setEditOpen(true)}>
              <UserCog className="mr-2 h-4 w-4" />
              <span>Edit contact details</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => {
              posthog?.capture('user_logged_out');
              posthog?.reset();
              logout();
            }}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={editOpen} onOpenChange={handleDialogChange}>
        <DialogContent>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Update contact details</DialogTitle>
              <DialogDescription>
                These details populate your email signature for support requests.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="profile-name">Full name</Label>
                <Input
                  id="profile-name"
                  value={formState.displayName}
                  onChange={handleFieldChange('displayName')}
                  placeholder="Jane Recruiter"
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-role">Job role</Label>
                {isSystemUserRole ? (
                  <Select
                    value={formState.jobRole}
                    onValueChange={handleRoleDetailChange}
                    disabled={saving}
                  >
                    <SelectTrigger id="profile-role">
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
                ) : (
                  <Input
                    id="profile-role"
                    value={formState.jobRole}
                    onChange={handleFieldChange('jobRole')}
                    placeholder="Senior Recruiter"
                    disabled={saving}
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-phone">US phone number</Label>
                <Input
                  id="profile-phone"
                  value={formState.phoneNumber}
                  onChange={handleFieldChange('phoneNumber')}
                  onBlur={handlePhoneBlur}
                  placeholder="+1 (555) 123-4567"
                  type="tel"
                  inputMode="numeric"
                  pattern="^\+1 \(\d{3}\) \d{3}-\d{4}$"
                  disabled={saving}
                />
              </div>
              <p className="text-xs text-muted-foreground">Company and website are derived from your email domain.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </header>
  );
}
