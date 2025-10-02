import { useCallback, useEffect, useState } from 'react';
import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import { checkMeetingConsent, openConsentAndPoll } from '../meetings/meetingsConsent';

interface ConsentState {
  needsConsent: boolean;
  checking: boolean;
  error: string;
  refresh: () => Promise<void>;
  grant: () => Promise<boolean>;
}

export function useOnlineMeetingConsent(
  instance: IPublicClientApplication,
  account: AccountInfo | undefined
): ConsentState {
  const [needsConsent, setNeedsConsent] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!account) {
      setNeedsConsent(false);
      return;
    }
    setChecking(true);
    setError('');
    try {
      const ok = await checkMeetingConsent(instance, account);
      setNeedsConsent(!ok);
    } catch (err) {
      setError((err as Error)?.message || 'Consent check failed');
    } finally {
      setChecking(false);
    }
  }, [instance, account]);

  const grant = useCallback(async () => {
    if (!account) {
      setError('Sign in with Microsoft to grant consent.');
      return false;
    }
    setChecking(true);
    setError('');
    try {
      const ok = await openConsentAndPoll(instance, account);
      setNeedsConsent(!ok);
      if (!ok) {
        setError('Timed out waiting for consent. Complete the popup and try again.');
      }
      return ok;
    } catch (err) {
      setError((err as Error)?.message || 'Consent attempt failed');
      return false;
    } finally {
      setChecking(false);
    }
  }, [instance, account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { needsConsent, checking, error, refresh, grant };
}
