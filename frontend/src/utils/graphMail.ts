import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import { API_BASE } from '@/constants';
import { acquireBackendToken } from '@/tokens';

export interface GraphMailPayload {
  message: Record<string, unknown>;
  saveToSentItems?: boolean;
}

export async function sendGraphMail(
  instance: IPublicClientApplication,
  account: AccountInfo,
  payload: GraphMailPayload
): Promise<Response> {
  const token = await acquireBackendToken(instance, account);
  if (!token) {
    throw new Error('Unable to acquire Microsoft Graph access token');
  }

  const response = await fetch(`${API_BASE}/api/graph/mail/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(payload)
  });

  return response;
}
