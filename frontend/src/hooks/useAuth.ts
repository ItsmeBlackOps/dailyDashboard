import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';

export const API_URL =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.DEV ? "https://dailydb.silverspace.tech" : "https://dailydb.silverspace.tech");

interface RefreshResponse {
  success: boolean;
  accessToken?: string;
  error?: string;
}

export async function requestRefreshToken(
  refreshToken: string,
  apiUrl: string = API_URL
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

/**
 * Provides authentication utilities for making authorized requests and managing session state.
 *
 * Includes functions to remove stored auth state and navigate to the sign-in page, refresh the stored access token using the saved refresh token, and perform fetch requests with automatic Authorization header handling and token refresh on 401 responses.
 *
 * @returns An object with the following properties:
 * - `authFetch`: a function `(url: string, options?: RequestInit) => Promise<Response>` that performs a fetch with the current access token, attempts a token refresh and retry on 401, and may call `logout` and throw on failure.
 * - `logout`: a function `() => void` that clears authentication and user-related keys from localStorage and navigates to `/auth/signin`.
 * - `refreshAccessToken`: a function `() => Promise<boolean>` that attempts to obtain and store a new access token using the stored refresh token and returns `true` on success, `false` otherwise.
 */
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

  return { authFetch, logout, refreshAccessToken };
}
