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

class FirefliesService {
  constructor() {
    const apiKey = config.fireflies.apiKey;
    this.apiKey = apiKey;
    this.graphqlUrl = config.fireflies.graphqlUrl;
    this.enabled = Boolean(apiKey);

    if (this.enabled) {
      logger.info('✅ Fireflies service configured');
    } else {
      logger.warn('⚠️ Fireflies disabled — set FIREFLIES_API_KEY to enable');
    }
  }

  async _request(query, variables = {}) {
    if (!this.enabled) {
      throw new FirefliesNotConfiguredError();
    }

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
      logger.error('Failed to parse Fireflies response', { error: err.message });
      parsed = text;
    }

    if (!response.ok) {
      throw new FirefliesRequestError(
        'Fireflies GraphQL request failed',
        response.status,
        parsed
      );
    }

    if (parsed.errors && parsed.errors.length > 0) {
      logger.error('Fireflies GraphQL errors', { errors: parsed.errors });
      throw new FirefliesRequestError(
        parsed.errors[0]?.message || 'Fireflies GraphQL error',
        response.status,
        parsed
      );
    }

    return parsed.data;
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

    const data = await this._request(query, variables);
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
export { FirefliesNotConfiguredError, FirefliesRequestError };
