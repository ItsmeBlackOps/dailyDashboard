// Shared helper — read a JSON response body but surface a useful error
// when the gateway/server returned something non-JSON (e.g. nginx 504
// HTML, the SPA's index.html on a misrouted request, or a stack-trace
// HTML page from a misconfigured error handler).
//
// Drop-in replacement for `await res.json()` after a fetch.

export class HttpError extends Error {
  status: number;
  bodySnippet: string;
  url: string;
  constructor(message: string, status: number, bodySnippet: string, url: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.bodySnippet = bodySnippet;
    this.url = url;
  }
}

const SNIPPET_LEN = 200;

export const parseJsonOrThrow = async <T = unknown>(res: Response): Promise<T> => {
  const ct = res.headers.get('content-type') || '';
  const isJson = ct.toLowerCase().includes('application/json');

  if (!isJson) {
    let bodySnippet = '';
    try {
      const text = await res.text();
      bodySnippet = text.slice(0, SNIPPET_LEN);
    } catch {
      // ignore
    }
    const looksLikeHtml = /^<!doctype\s|^<html/i.test(bodySnippet.trim());
    const reason = looksLikeHtml
      ? `gateway returned HTML (likely a 5xx error page or SPA fallback) for ${res.url}`
      : `non-JSON response (content-type: ${ct || 'none'}) for ${res.url}`;
    // Log with status + snippet so the network condition is recoverable
    // from console even when the user only sees a friendly toast.
    // eslint-disable-next-line no-console
    console.error('parseJsonOrThrow', {
      url: res.url, status: res.status, contentType: ct, bodySnippet,
    });
    throw new HttpError(reason, res.status, bodySnippet, res.url);
  }

  if (!res.ok) {
    // JSON-shaped error response. Surface the server-provided message.
    let payload: { error?: string; message?: string } | null = null;
    try {
      payload = await res.json();
    } catch {
      // fall through
    }
    const msg = payload?.error || payload?.message || `HTTP ${res.status}`;
    throw new HttpError(msg, res.status, JSON.stringify(payload || {}).slice(0, SNIPPET_LEN), res.url);
  }

  return (await res.json()) as T;
};
