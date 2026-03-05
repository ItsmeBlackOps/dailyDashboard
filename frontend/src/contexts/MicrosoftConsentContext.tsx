import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useMsal, useAccount } from '@azure/msal-react';
import { useOnlineMeetingConsent } from '@/hooks/useOnlineMeetingConsent';

interface MicrosoftConsentContextValue {
  needsConsent: boolean;
  checking: boolean;
  error: string;
  hasAccount: boolean;
  grant: () => Promise<boolean>;
  refresh: () => Promise<void>;
  openConsentDialog: () => void;
  closeConsentDialog: () => void;
  isDialogOpen: boolean;
}

const MicrosoftConsentContext = createContext<MicrosoftConsentContextValue | null>(null);

export function MicrosoftConsentProvider({ children }: { children: ReactNode }) {
  const { instance, accounts } = useMsal();
  const account = useAccount(accounts?.[0] ?? null) ?? undefined;
  const { needsConsent, checking, error, grant, refresh } = useOnlineMeetingConsent(instance, account);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    if (checking) {
      hasCheckedRef.current = true;
      return;
    }
    if (hasCheckedRef.current && needsConsent) {
      if (!sessionStorage.getItem('teamsConsentShown')) {
        sessionStorage.setItem('teamsConsentShown', '1');
        setIsDialogOpen(true);
      }
    }
  }, [checking, needsConsent]);

  const openConsentDialog = () => setIsDialogOpen(true);
  const closeConsentDialog = () => setIsDialogOpen(false);

  return (
    <MicrosoftConsentContext.Provider
      value={{
        needsConsent,
        checking,
        error,
        hasAccount: !!account,
        grant,
        refresh,
        openConsentDialog,
        closeConsentDialog,
        isDialogOpen,
      }}
    >
      {children}
    </MicrosoftConsentContext.Provider>
  );
}

export function useMicrosoftConsent(): MicrosoftConsentContextValue {
  const ctx = useContext(MicrosoftConsentContext);
  if (!ctx) throw new Error('useMicrosoftConsent must be used within MicrosoftConsentProvider');
  return ctx;
}
