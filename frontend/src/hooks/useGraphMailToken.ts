import { useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import { GRAPH_MAIL_SCOPES } from '@/constants';

/**
 * Acquire a Microsoft Graph access token (Mail.Send) for the signed-in user.
 *
 * This is the SAME delegated mechanism Interview Support / Assessment Support
 * use to send mail from the user's own mailbox: the browser obtains a Graph
 * token and the backend calls `graphMailService.sendDelegatedMail` (→
 * `/me/sendMail`). It needs NO app "from" mailbox (AZURE_GRAPH_MAIL_SENDER) —
 * the message is sent from the requester's mailbox.
 *
 * Throws if a token cannot be obtained (silent → popup → reject). Callers
 * should surface the failure rather than silently dropping the send.
 */
export function useGraphMailToken() {
  const { instance, accounts } = useMsal();
  const account = accounts[0];

  const acquireGraphAccessToken = useCallback(async (): Promise<string> => {
    let activeAccount = instance.getActiveAccount() ?? account ?? null;
    let graphToken = '';
    try {
      if (!activeAccount) {
        const loginResult = await instance.loginPopup({ scopes: GRAPH_MAIL_SCOPES });
        activeAccount = loginResult.account ?? loginResult.accounts?.[0] ?? null;
        graphToken = loginResult.accessToken || '';
        if (activeAccount) {
          instance.setActiveAccount(activeAccount);
        }
      }

      if (activeAccount && !graphToken) {
        try {
          const tokenResponse = await instance.acquireTokenSilent({
            account: activeAccount,
            scopes: GRAPH_MAIL_SCOPES,
          });
          graphToken = tokenResponse.accessToken;
        } catch (tokenError) {
          console.warn('Silent Graph token acquisition failed, attempting popup', tokenError);
          const popupResponse = await instance.acquireTokenPopup({ scopes: GRAPH_MAIL_SCOPES });
          graphToken = popupResponse.accessToken;
        }
      }

      if (!graphToken) {
        throw new Error('Unable to acquire Graph access token');
      }
      return graphToken;
    } catch (tokenError) {
      console.error('Failed to acquire Graph token', tokenError);
      throw tokenError instanceof Error ? tokenError : new Error('Unable to acquire Graph access token');
    }
  }, [account, instance]);

  return { acquireGraphAccessToken };
}
