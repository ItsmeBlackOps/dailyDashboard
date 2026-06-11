import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

class FirefliesNotConfiguredError extends Error {
  constructor() {
    super('Fireflies integration is not configured');
    this.name = 'FirefliesNotConfiguredError';
  }
}

class FirefliesRequestError extends Error {
  constructor(message, status, responseBody) {
    super(message);
    this.name = 'FirefliesRequestError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

// Distinct from FirefliesRequestError — the scheduler treats this as
// "back off, don't change botStatus, try again next tick after cooldown".
// Plain FirefliesRequestError means "this task is broken, mark failed".
class FirefliesRateLimitError extends Error {
  constructor(retryAfterEpochMs, responseBody) {
    const seconds = Math.max(0, Math.ceil((retryAfterEpochMs - Date.now()) / 1000));
    super(`Fireflies rate-limited; retry after ${new Date(retryAfterEpochMs).toISOString()} (in ${seconds}s)`);
    this.name = 'FirefliesRateLimitError';
    this.retryAfterEpochMs = retryAfterEpochMs;
    this.responseBody = responseBody;
  }
}

// Fireflies returns 429 in TWO shapes:
//   1. HTTP 429 with a Retry-After header (rare in practice for them)
//   2. HTTP 200 with body.errors[0].extensions.code === 'too_many_requests'
//      and body.errors[0].extensions.metadata.retryAfter (epoch ms)
// Both must produce the same cooldown behavior; the previous code only
// branched on response.status === 429 and missed shape #2 entirely,
// which is what's actually happening in prod per the audit.
const extractGraphQLRateLimit = (parsed) => {
  if (!parsed || !Array.isArray(parsed.errors) || parsed.errors.length === 0) return null;
  const err = parsed.errors[0];
  const ext = err?.extensions || {};
  const isRateLimit =
    ext.code === 'too_many_requests' ||
    err?.code === 'too_many_requests' ||
    ext.status === 429;
  if (!isRateLimit) return null;
  let retryAfter = ext.metadata?.retryAfter;
  if (typeof retryAfter !== 'number') {
    // Fallback: parse the ISO-ish string from the error message.
    const m = (err.message || '').match(/retry after\s+(.+?)\s*\(?UTC\)?/i);
    if (m) {
      const t = Date.parse(m[1]);
      if (!isNaN(t)) retryAfter = t;
    }
  }
  if (typeof retryAfter !== 'number') {
    // Last resort — 60s from now so we don't busy-loop.
    retryAfter = Date.now() + 60_000;
  }
  return retryAfter;
};

// Fireflies has answered 429 with "retry after next midnight UTC" — honoring
// that verbatim silenced the bot scheduler for a whole day at a time. Cap how
// long any single 429 can mute us; worst case we probe once per cap window.
const COOLDOWN_CAP_MS = parseInt(process.env.FIREFLIES_COOLDOWN_CAP_MS || String(60 * 60 * 1000), 10);

class FirefliesService {
  constructor() {
    const apiKey = config.fireflies.apiKey;
    this.apiKey = apiKey;
    this.graphqlUrl = config.fireflies.graphqlUrl;
    this.enabled = Boolean(apiKey);
    // Set when Fireflies returns a rate-limit error. Subsequent
    // _request() calls short-circuit until this clears. Per-process —
    // each backend container holds its own cooldown clock.
    //
    // Two clocks: read operations (status checks, diagnostics) must never
    // mute invite mutations — a stray 429 from a read once silenced the
    // bot scheduler for a month. Invite-path 429s set both clocks.
    this._rateLimitedUntil = 0;        // read operations
    this._inviteRateLimitedUntil = 0;  // invite mutations — the scheduler gates on this

    if (this.enabled) {
      logger.info('✅ Fireflies service configured');
    } else {
      logger.warn('⚠️ Fireflies disabled — set FIREFLIES_API_KEY to enable');
    }
  }

  isRateLimited(kind = 'read') {
    const until = kind === 'invite' ? this._inviteRateLimitedUntil : this._rateLimitedUntil;
    return Date.now() < until;
  }

  getRateLimitedUntil(kind = 'read') {
    return kind === 'invite' ? this._inviteRateLimitedUntil : this._rateLimitedUntil;
  }

  _applyRateLimit(retryAfterEpochMs, source, op = 'read') {
    const capped = Math.min(retryAfterEpochMs, Date.now() + COOLDOWN_CAP_MS);
    if (capped > this._rateLimitedUntil) {
      this._rateLimitedUntil = capped;
    }
    if (op === 'invite' && capped > this._inviteRateLimitedUntil) {
      this._inviteRateLimitedUntil = capped;
    }
    const seconds = Math.ceil((capped - Date.now()) / 1000);
    logger.warn('Fireflies rate-limited — cooldown engaged', {
      source,
      op,
      until: new Date(capped).toISOString(),
      seconds,
      cappedFrom: retryAfterEpochMs !== capped ? new Date(retryAfterEpochMs).toISOString() : undefined,
    });
  }

  // Bug 3 fix — _request now retries on transient failures (5xx, network)
  // with exponential backoff. Permanent failures (4xx other than 429,
  // GraphQL errors[]) fail fast — no retry. Each attempt is logged at
  // warn so we can spot recurring transient noise without it being a
  // single log line per stage.
  async _request(query, variables = {}, { maxAttempts = 3, op = 'read' } = {}) {
    if (!this.enabled) {
      throw new FirefliesNotConfiguredError();
    }

    // Fail-fast if we're still in cooldown from a prior rate-limit.
    // Avoids burning another quota unit and propagates a typed error
    // the scheduler knows not to mark the task as failed. Gated per
    // operation kind so read cooldowns never block invite mutations.
    if (this.isRateLimited(op)) {
      throw new FirefliesRateLimitError(this.getRateLimitedUntil(op), null);
    }

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(this.graphqlUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ query, variables }),
        });

        const text = await response.text();
        let parsed;
        try {
          parsed = text ? JSON.parse(text) : {};
        } catch (err) {
          logger.error('Failed to parse Fireflies response', { error: err.message, attempt });
          parsed = text;
        }

        if (!response.ok) {
          // Shape #1 — proper HTTP 429. Honor Retry-After header if present.
          if (response.status === 429) {
            const retryHeader = response.headers.get('retry-after');
            let retryAfter;
            if (retryHeader && /^\d+$/.test(retryHeader)) {
              retryAfter = Date.now() + parseInt(retryHeader, 10) * 1000;
            } else if (retryHeader) {
              const parsedTs = Date.parse(retryHeader);
              retryAfter = !isNaN(parsedTs) ? parsedTs : Date.now() + 60_000;
            } else {
              retryAfter = Date.now() + 60_000;
            }
            this._applyRateLimit(retryAfter, 'http-429', op);
            throw new FirefliesRateLimitError(retryAfter, parsed);
          }
          const isRetryable = response.status >= 500;
          if (isRetryable && attempt < maxAttempts) {
            logger.warn('Fireflies request transient failure, retrying', {
              status: response.status, attempt, maxAttempts,
            });
            lastError = new FirefliesRequestError(
              'Fireflies GraphQL request failed', response.status, parsed
            );
            await this._sleep(500 * Math.pow(2, attempt - 1));
            continue;
          }
          throw new FirefliesRequestError(
            'Fireflies GraphQL request failed', response.status, parsed
          );
        }

        if (parsed.errors && parsed.errors.length > 0) {
          // Shape #2 — HTTP 200 with GraphQL errors[]. Fireflies's
          // actual rate-limit response in prod. extensions.code is
          // 'too_many_requests' and extensions.metadata.retryAfter
          // carries the cooldown epoch ms directly.
          const retryAfter = extractGraphQLRateLimit(parsed);
          if (retryAfter !== null) {
            this._applyRateLimit(retryAfter, 'graphql-too-many-requests', op);
            throw new FirefliesRateLimitError(retryAfter, parsed);
          }

          // Real GraphQL error (bad query, bad arguments). Permanent.
          logger.error('Fireflies GraphQL errors', { errors: parsed.errors, attempt });
          throw new FirefliesRequestError(
            parsed.errors[0]?.message || 'Fireflies GraphQL error',
            response.status, parsed
          );
        }

        return parsed.data;
      } catch (err) {
        // Network-layer error (DNS, ECONNRESET) — retry. Anything we
        // already classified above (FirefliesRequestError,
        // FirefliesRateLimitError, FirefliesNotConfiguredError) bubbles
        // straight up. RateLimit specifically must NOT retry because
        // we've already set the cooldown and we'd just burn another
        // quota unit on each in-tick attempt.
        if (err instanceof FirefliesRequestError ||
            err instanceof FirefliesRateLimitError ||
            err instanceof FirefliesNotConfiguredError) {
          throw err;
        }
        if (attempt < maxAttempts) {
          logger.warn('Fireflies network error, retrying', {
            error: err.message, attempt, maxAttempts,
          });
          lastError = err;
          await this._sleep(500 * Math.pow(2, attempt - 1));
          continue;
        }
        throw err;
      }
    }
    // unreachable, but keeps the type-checker happy
    throw lastError || new Error('Fireflies request failed after retries');
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async inviteBot({ meetingLink, title, duration, password }) {
    const query = `
      mutation AddToLiveMeeting($meeting_link: String, $title: String, $meeting_password: String, $duration: Int) {
        addToLiveMeeting(meeting_link: $meeting_link, title: $title, meeting_password: $meeting_password, duration: $duration) {
          message
          success
        }
      }
    `;

    const variables = {
      meeting_link: meetingLink,
      title: title,
      ...(password != null && { meeting_password: password }),
      ...(duration != null && { duration: parseInt(duration, 10) }),
    };

    const data = await this._request(query, variables, { op: 'invite' });
    return {
      success: data?.addToLiveMeeting?.success ?? false,
      message: data?.addToLiveMeeting?.message ?? '',
    };
  }

  async getActiveMeetings() {
    const query = `
      query ActiveMeetings {
        active_meetings(input: {}) {
          id
          meeting_link
          title
          meeting_id
        }
      }
    `;

    let data;
    try {
      data = await this._request(query);
    } catch (err) {
      if (err instanceof FirefliesNotConfiguredError) throw err;

      // Fall back to __typename only if unknown fields caused the error
      logger.warn('Fireflies active_meetings failed with full fields, retrying with __typename only', {
        error: err.message,
      });
      const fallbackQuery = `
        query ActiveMeetings {
          active_meetings(input: {}) {
            __typename
          }
        }
      `;
      data = await this._request(fallbackQuery);
    }

    return data?.active_meetings ?? [];
  }

  async isBotInMeeting(meetingLink) {
    if (!meetingLink) return false;
    const meetings = await this.getActiveMeetings();
    const needle = meetingLink.toLowerCase();
    return meetings.some((m) => {
      const link = (m.meeting_link || '').toLowerCase();
      return link.includes(needle) || needle.includes(link);
    });
  }
}

export const firefliesService = new FirefliesService();
export { FirefliesNotConfiguredError, FirefliesRequestError, FirefliesRateLimitError };
