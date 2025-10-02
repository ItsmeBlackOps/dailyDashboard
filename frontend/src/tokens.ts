import { InteractionRequiredAuthError, type AccountInfo, type IPublicClientApplication } from '@azure/msal-browser';
import { LOGIN_SCOPES } from './constants';

export async function acquireBackendToken(
  instance: IPublicClientApplication,
  account: AccountInfo,
  scope?: string
): Promise<string> {
  const scopes = scope ? [scope] : LOGIN_SCOPES;

  try {
    const result = await instance.acquireTokenSilent({
      account,
      scopes,
    });
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      try {
        const result = await instance.acquireTokenPopup({
          account,
          scopes,
        });
        return result.accessToken;
      } catch {
        await instance.acquireTokenRedirect({
          account,
          scopes,
        });
        return '';
      }
    }
    throw error;
  }
}
