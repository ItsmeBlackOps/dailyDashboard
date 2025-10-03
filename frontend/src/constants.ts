const fallbackApiBase =
  import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'https://dailydb.silverspace.tech' : 'https://dailydb.silverspace.tech');

export const API_BASE = import.meta.env.VITE_API_BASE || fallbackApiBase;
export const API_SCOPE = (import.meta.env.VITE_API_SCOPE || 'api://4fc9e095-61df-4a55-9b0c-2419747b96d0/User.Read').trim();
export const LOGIN_SCOPES = (
  import.meta.env.VITE_LOGIN_SCOPES ||
  'User.Read https://graph.microsoft.com/OnlineMeetings.ReadWrite https://graph.microsoft.com/Calendars.ReadWrite https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read'
)
  .split(/\s+/)
  .filter(Boolean);

export const GRAPH_MAIL_SCOPES = (
  import.meta.env.VITE_GRAPH_MAIL_SCOPES ||
  'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read'
)
  .split(/\s+/)
  .filter(Boolean);
export const AZURE_CLIENT_ID = (import.meta.env.VITE_AZURE_CLIENT_ID || '4fc9e095-61df-4a55-9b0c-2419747b96d0').trim();
export const AZURE_TENANT_ID = (import.meta.env.VITE_AZURE_TENANT_ID || '4ece6d1e-592c-44f1-b187-6076e9180510').trim();
export const AZURE_AUTHORITY =
  (import.meta.env.VITE_AZURE_AUTHORITY || '').trim() ||
  `https://login.microsoftonline.com/${AZURE_TENANT_ID}`;
const defaultRedirect =
  typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://dailydf.silverspace.tech';

export const AZURE_REDIRECT_URI =
  (import.meta.env.VITE_AZURE_REDIRECT_URI || defaultRedirect).trim();
