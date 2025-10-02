import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import { API_BASE, API_SCOPE, LOGIN_SCOPES } from '../constants';

async function acquireUserToken(instance: IPublicClientApplication, account: AccountInfo) {
  const scopes = API_SCOPE ? [API_SCOPE] : LOGIN_SCOPES;
  const result = await instance.acquireTokenSilent({ account, scopes });
  return result.accessToken;
}

export async function checkMeetingConsent(instance: IPublicClientApplication, account: AccountInfo): Promise<boolean> {
  if (!instance || !account) return false;
  const token = await acquireUserToken(instance, account);

  const response = await fetch(`${API_BASE}/api/graph/health/meetings`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return response.status === 200;
}

export async function openConsentAndPoll(
  instance: IPublicClientApplication,
  account: AccountInfo,
  options: { pollMs?: number; maxTries?: number } = {}
): Promise<boolean> {
  const { pollMs = 2000, maxTries = 30 } = options;

  let popup: Window | null = null;
  try {
    popup = window.open(
      `${API_BASE}/auth/consent`,
      '_blank',
      'noopener,noreferrer,width=600,height=700'
    );
  } catch (error) {
    console.error('Failed to open consent window', error);
  }

  for (let attempt = 0; attempt < maxTries; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await safeCheck(instance, account);
    if (ok) {
      try {
        if (popup && !popup.closed) {
          popup.close();
        }
      } catch (error) {
        console.warn('Failed to close consent popup', error);
      }
      return true;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return false;
}

async function safeCheck(instance: IPublicClientApplication, account: AccountInfo) {
  try {
    return await checkMeetingConsent(instance, account);
  } catch (error) {
    console.warn('Consent check failed during polling', error);
    return false;
  }
}
