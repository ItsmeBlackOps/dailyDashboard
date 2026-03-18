import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';

import { API_URL, useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { trackError } from '@/utils/trackError';

export interface UserProfile {
  email: string;
  displayName: string;
  jobRole: string;
  phoneNumber: string;
  companyName: string;
  companyUrl: string;
  requiresRoleDetailSelection?: boolean;
  allowedRoleDetails?: string[];
  isComplete: boolean;
}

interface UpdateProfilePayload {
  displayName: string;
  jobRole: string;
  phoneNumber: string;
}

interface UserProfileContextValue {
  profile: UserProfile | null;
  loading: boolean;
  saving: boolean;
  refresh: () => Promise<void>;
  updateProfile: (updates: UpdateProfilePayload) => Promise<void>;
}

const UserProfileContext = createContext<UserProfileContextValue | undefined>(undefined);

const sanitizePlainText = (value: string) =>
  DOMPurify.sanitize(value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] }).replace(/\s+/g, ' ').trim();

const digitsOnly = (value: string) => value.replace(/\D/g, '');

const formatPhoneCanonical = (value: string): string => {
  const stripped = digitsOnly(value);
  if (!stripped) return '';

  let normalized = stripped;
  if (normalized.length === 10) {
    normalized = `1${normalized}`;
  }

  if (normalized.length !== 11 || !normalized.startsWith('1')) {
    return '';
  }

  const area = normalized.slice(1, 4);
  const prefix = normalized.slice(4, 7);
  const line = normalized.slice(7, 11);
  return `+1 (${area}) ${prefix}-${line}`;
};

const formatPhoneDraft = (value: string): string => {
  const stripped = digitsOnly(value);
  if (!stripped) return '';

  let normalized = stripped;
  if (normalized.startsWith('1')) {
    normalized = normalized.slice(1);
  }
  normalized = normalized.slice(0, 10);

  let result = '+1';
  if (!normalized) {
    return result;
  }
  result += ' (';
  if (normalized.length <= 3) {
    return `${result}${normalized}`;
  }
  const area = normalized.slice(0, 3);
  result += `${area})`;

  if (normalized.length <= 3) {
    return result;
  }

  const prefix = normalized.slice(3, 6);
  if (prefix) {
    result += ` ${prefix}`;
  }

  if (normalized.length <= 6) {
    return result;
  }

  const line = normalized.slice(6, 10);
  result += `-${line}`;
  return result;
};

export const UserProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { authFetch } = useAuth();
  const { toast } = useToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API_URL}/api/profile/me`);
      if (!res.ok) {
        throw new Error('Unable to load profile');
      }
      const payload = await res.json();
      setProfile(payload?.profile ?? null);
    } catch (error) {
      trackError('Failed to load profile metadata', error, {
        api_url: `${API_URL}/api/profile/me`,
      });
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const updateProfile = useCallback(async (updates: UpdateProfilePayload) => {
    setSaving(true);
    try {
      const sanitized = {
        displayName: sanitizePlainText(updates.displayName),
        jobRole: sanitizePlainText(updates.jobRole),
        phoneNumber: formatPhoneCanonical(updates.phoneNumber)
      };

      if (!sanitized.phoneNumber) {
        throw new Error('Phone number must follow +1 (123) 456-7890 format');
      }

      const res = await authFetch(`${API_URL}/api/profile/me`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitized)
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Unable to update profile');
      }

      setProfile(payload?.profile ?? null);
      toast({
        title: 'Profile updated',
        description: 'Your contact details were saved successfully.'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update profile';
      toast({ title: 'Profile update failed', description: message, variant: 'destructive' });
      throw error;
    } finally {
      setSaving(false);
    }
  }, [authFetch, toast]);

  const value = useMemo<UserProfileContextValue>(() => ({
    profile,
    loading,
    saving,
    refresh: fetchProfile,
    updateProfile
  }), [profile, loading, saving, fetchProfile, updateProfile]);

  return (
    <UserProfileContext.Provider value={value}>
      {children}
    </UserProfileContext.Provider>
  );
};

export const useUserProfile = (): UserProfileContextValue => {
  const ctx = useContext(UserProfileContext);
  if (!ctx) {
    throw new Error('useUserProfile must be used within a UserProfileProvider');
  }
  return ctx;
};

export { formatPhoneDraft, formatPhoneCanonical };
