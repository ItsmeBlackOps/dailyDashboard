import { ConfidentialClientApplication } from '@azure/msal-node';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const GRAPH_ENDPOINT = 'https://graph.microsoft.com/v1.0/me/onlineMeetings';

class AzureMeetingsNotConfiguredError extends Error {
  constructor() {
    super('Azure meetings integration is not configured');
    this.name = 'AzureMeetingsNotConfiguredError';
  }
}

class MissingUserAssertionError extends Error {
  constructor() {
    super('Missing bearer token for On-Behalf-Of exchange');
    this.name = 'MissingUserAssertionError';
  }
}

class GraphRequestError extends Error {
  constructor(message, status, responseBody) {
    super(message);
    this.name = 'GraphRequestError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

class GraphMeetingService {
  constructor() {
    this.scopes = config.azure.meetingScopes;
    this.redirectUri = config.azure.redirectUri;
    this.authority = `https://login.microsoftonline.com/${config.azure.tenantId}`;
    this.enabled = Boolean(config.azure.clientId && config.azure.clientSecret);

    if (this.enabled) {
      this.cca = new ConfidentialClientApplication({
        auth: {
          clientId: config.azure.clientId,
          clientSecret: config.azure.clientSecret,
          authority: this.authority
        }
      });
      logger.info('✅ Azure meeting service configured');
    } else {
      this.cca = null;
      logger.warn('⚠️ Azure meeting service disabled. Missing AZURE_CLIENT_ID or AZURE_CLIENT_SECRET');
    }
  }

  ensureEnabled() {
    if (!this.enabled || !this.cca) {
      throw new AzureMeetingsNotConfiguredError();
    }
  }

  async getConsentUrl(state = 'meetings') {
    this.ensureEnabled();
    return this.cca.getAuthCodeUrl({
      scopes: this.scopes,
      redirectUri: this.redirectUri,
      prompt: 'consent',
      state
    });
  }

  async completeConsent(code) {
    this.ensureEnabled();
    if (!code) {
      throw new Error('Missing authorization code');
    }

    await this.cca.acquireTokenByCode({
      code,
      scopes: this.scopes,
      redirectUri: this.redirectUri
    });
  }

  async acquireOnBehalfOfToken(userAssertion, scopes = this.scopes) {
    this.ensureEnabled();
    if (!userAssertion) {
      throw new MissingUserAssertionError();
    }

    const result = await this.cca.acquireTokenOnBehalfOf({
      oboAssertion: userAssertion,
      scopes
    });

    if (!result || !result.accessToken) {
      throw new Error('Failed to acquire access token for Microsoft Graph');
    }

    return result.accessToken;
  }

  async health(userAssertion) {
    try {
      await this.acquireOnBehalfOfToken(userAssertion, this.scopes);
      return { status: 'ok' };
    } catch (error) {
      throw error;
    }
  }

  async createMeeting(userAssertion, meetingPayload) {
    const accessToken = await this.acquireOnBehalfOfToken(userAssertion, this.scopes);

    const response = await fetch(GRAPH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(meetingPayload)
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (error) {
      logger.error('Failed to parse Graph response', { error: error.message });
      parsed = text;
    }

    if (!response.ok) {
      throw new GraphRequestError('Microsoft Graph request failed', response.status, parsed);
    }

    return parsed;
  }

  /**
   * Search the signed-in user's mailbox for every message whose subject
   * matches `subject`. Returns up to `top` results from the last `days`
   * days, sorted oldest-first so consumers can replay them in order.
   *
   * @param {string} userAssertion - Bearer token (OBO assertion).
   * @param {string} subject - exact-ish subject to search for.
   * @param {number} days - how far back to look (default 90).
   * @param {number} top - max messages (default 50).
   */
  async searchMessagesBySubject(userAssertion, subject, days = 90, top = 50) {
    if (!subject || typeof subject !== 'string') {
      throw new Error('subject is required');
    }
    const accessToken = await this.acquireOnBehalfOfToken(userAssertion, this.scopes);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    // Use $filter (not $search) so we can combine with receivedDateTime range
    // and so we can request the body. Quote and escape the subject string.
    const escaped = subject.replace(/'/g, "''");
    const params = new URLSearchParams({
      $filter: `receivedDateTime ge ${since} and subject eq '${escaped}'`,
      $select: 'id,subject,from,receivedDateTime,body',
      $top: String(top),
      $orderby: 'receivedDateTime asc',
    });
    const url = `https://graph.microsoft.com/v1.0/me/messages?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.body-content-type="text"',
      },
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (error) {
      logger.error('Failed to parse Graph search response', { error: error.message });
      throw new GraphRequestError('Graph search returned non-JSON', response.status, text);
    }

    if (!response.ok) {
      throw new GraphRequestError('Graph search failed', response.status, parsed);
    }

    return Array.isArray(parsed.value) ? parsed.value : [];
  }
}

export const graphMeetingService = new GraphMeetingService();
export { AzureMeetingsNotConfiguredError, MissingUserAssertionError, GraphRequestError };
