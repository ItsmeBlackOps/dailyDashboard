import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_URL, requestRefreshToken } from '@/hooks/useAuth';

async function hubFetch(url: string, navigate: ReturnType<typeof useNavigate>): Promise<Response> {
  const doFetch = (token: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  let token = localStorage.getItem('accessToken') || '';
  let res = await doFetch(token);

  if (res.status === 401) {
    const refreshToken = localStorage.getItem('refreshToken') || '';
    const newToken = refreshToken ? await requestRefreshToken(refreshToken) : null;
    if (!newToken) {
      navigate('/auth/signin');
      throw new Error('Unauthorized');
    }
    localStorage.setItem('accessToken', newToken);
    res = await doFetch(newToken);
  }

  return res;
}

export function useHubFetch<T>(path: string, deps: unknown[] = []) {
  const navigate = useNavigate();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await hubFetch(`${API_URL}/api/candidates/${path}`, navigate);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Request failed');
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [path, navigate]);

  useEffect(() => { load(); }, [load, ...deps]);

  return { data, loading, error, reload: load };
}
