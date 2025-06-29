import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';

export const API_URL = 'https://s02lbgvv-3004.inc1.devtunnels.ms/';

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

export function useAuth() {
  const navigate = useNavigate();

  const logout = useCallback(() => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
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

  return { authFetch, logout };
}
