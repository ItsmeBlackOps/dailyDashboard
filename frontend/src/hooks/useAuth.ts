import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';

const DEFAULT_HTTP_URL = import.meta.env.DEV
  ? 'http://localhost:3004'
  : 'https://dailydb.silverspace.tech';

const normalizeHttpUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_HTTP_URL;
  }
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '').replace(/\/api$/i, '');
  if (/^wss?:\/\//i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
  }
  return withoutTrailingSlash;
};

const normalizeSocketUrl = (value: string, fallback: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '').replace(/\/api$/i, '');
  return withoutTrailingSlash;
};

const resolveHttpUrl = () => {
  const candidates = [import.meta.env.VITE_API_URL, DEFAULT_HTTP_URL];
  const raw = candidates.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
  return normalizeHttpUrl(raw || DEFAULT_HTTP_URL);
};

const resolveSocketUrl = (httpUrl: string) => {
  const candidates = [import.meta.env.VITE_SOCKET_URL, import.meta.env.VITE_API_URL, httpUrl];
  const raw = candidates.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
  return normalizeSocketUrl(raw || httpUrl, httpUrl);
};

export const API_URL = resolveHttpUrl();
export const SOCKET_URL = resolveSocketUrl(API_URL);

interface RefreshResponse {
  success: boolean;
  accessToken?: string;
  error?: string;
}

export async function requestRefreshToken(
  refreshToken: string,
  apiUrl: string = SOCKET_URL
): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = io(apiUrl, { autoConnect: false, transports: ['websocket'] });

    socket.on('connect_error', () => {
      socket.disconnect();
      resolve(null);
    });

    socket.connect();
    socket.emit('refresh', { refreshToken }, (resp: RefreshResponse) => {
      socket.disconnect();
      if (resp && resp.success && resp.accessToken) {
        resolve(resp.accessToken);
      } else {
        resolve(null);
      }
    });
  });
}

export function useAuth() {
  const navigate = useNavigate();

  const logout = useCallback(() => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('role');
    localStorage.removeItem('teamLead');
    localStorage.removeItem('manager');
    localStorage.removeItem('email');
    localStorage.removeItem('displayName');
    navigate('/auth/signin');
  }, [navigate]);

  const refreshAccessToken = useCallback(async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return false;
    const newToken = await requestRefreshToken(refreshToken);
    if (!newToken) return false;
    localStorage.setItem('accessToken', newToken);
    return true;
  }, []);

  const authFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      let token = localStorage.getItem('accessToken');
      if (!token) {
        logout();
        throw new Error('No token');
      }
      let res = await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
      });
      if (res.status === 401) {
        const refreshed = await refreshAccessToken();
        if (!refreshed) {
          logout();
          throw new Error('Unauthorized');
        }
        token = localStorage.getItem('accessToken');
        res = await fetch(url, {
          ...options,
          headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
        });
      }
      return res;
    },
    [logout, refreshAccessToken]
  );

  const user = {
    email: localStorage.getItem('email'),
    role: localStorage.getItem('role'),
    branch: localStorage.getItem('branch'), // Assuming branch is stored or derived
    displayName: localStorage.getItem('displayName'),
    teamLead: localStorage.getItem('teamLead'),
    manager: localStorage.getItem('manager'),
    permissions: [] as string[],
    scopes: {} as Record<string, string>
  };

  try {
    const p = localStorage.getItem('permissions');
    if (p) user.permissions = JSON.parse(p);
    const s = localStorage.getItem('scopes');
    if (s) user.scopes = JSON.parse(s);
  } catch (e) {
    console.error('Failed to parse auth permissions', e);
  }

  const hasPermission = useCallback((permission: string) => {
    // If no permissions loaded (legacy or error), fallback to false or safe default?
    // For now precise check.
    return user.permissions.includes(permission);
  }, [user.permissions]); // Re-create if permissions change (login/logout reload page anyway)

  return { authFetch, logout, refreshAccessToken, user, hasPermission };
}
