import { ConfidentialClientApplication } from '@azure/msal-node';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const GRAPH_MAIL_ENDPOINT = 'https://graph.microsoft.com/v1.0/me/sendMail';
const GRAPH_DRAFT_ENDPOINT = 'https://graph.microsoft.com/v1.0/me/messages';
const GRAPH_SCOPE_DEFAULT = 'https://graph.microsoft.com/.default';

class AzureMailNotConfiguredError extends Error {
  constructor() {
    super('Azure mail integration is not configured');
    this.name = 'AzureMailNotConfiguredError';
  }
}

class MissingUserAssertionError extends Error {
  constructor() {
    super('Missing bearer token for On-Behalf-Of exchange');
    this.name = 'MissingUserAssertionError';
  }
}

class GraphMailRequestError extends Error {
  constructor(message, status, responseBody) {
    super(message);
    this.name = 'GraphMailRequestError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

class GraphMailService {
  constructor() {
    this.scopes = config.azure.mailScopes;
    this.authority = `https://login.microsoftonline.com/${config.azure.tenantId}`;
    this.mailSender = config.azure.mailSender || '';
    this.enabled = Boolean(
      config.azure.clientId &&
      config.azure.clientSecret &&
      Array.isArray(this.scopes) &&
      this.scopes.length > 0
    );

    if (this.enabled) {
      this.cca = new ConfidentialClientApplication({
        auth: {
          clientId: config.azure.clientId,
          clientSecret: config.azure.clientSecret,
          authority: this.authority
        }
      });
      logger.info('✅ Azure mail service configured');
    } else {
      this.cca = null;
      logger.warn('⚠️ Azure mail service disabled. Check AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_GRAPH_MAIL_SCOPES');
    }
  }

  ensureEnabled() {
    if (!this.enabled || !this.cca) {
      throw new AzureMailNotConfiguredError();
    }
  }

  async acquireClientCredentialToken() {
    this.ensureEnabled();
    const result = await this.cca.acquireTokenByClientCredential({
      scopes: [GRAPH_SCOPE_DEFAULT]
    });

    if (!result || !result.accessToken) {
      throw new Error('Failed to acquire client credential token for Microsoft Graph mail send');
    }

    return result.accessToken;
  }

  async acquireOnBehalfOfToken(userAssertion) {
    this.ensureEnabled();
    if (!userAssertion) {
      throw new MissingUserAssertionError();
    }

    const result = await this.cca.acquireTokenOnBehalfOf({
      oboAssertion: userAssertion,
      scopes: this.scopes
    });

    if (!result || !result.accessToken) {
      throw new Error('Failed to acquire access token for Microsoft Graph mail send');
    }

    return result.accessToken;
  }

  async sendMail(userAssertion, mailPayload) {
    const accessToken = await this.acquireOnBehalfOfToken(userAssertion);

    const response = await fetch(GRAPH_MAIL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(mailPayload)
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (error) {
      logger.error('Failed to parse Graph mail response', { error: error.message });
      parsed = text;
    }

    if (!response.ok) {
      throw new GraphMailRequestError('Microsoft Graph mail request failed', response.status, parsed);
    }

    return parsed;
  }

  async sendDelegatedMail(accessToken, mailPayload) {
    if (!accessToken) {
      throw new Error('Missing Graph access token');
    }

    const response = await fetch(GRAPH_MAIL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(mailPayload)
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (error) {
      logger.error('Failed to parse Graph mail response', { error: error.message });
      parsed = text;
    }

    if (!response.ok) {
      throw new GraphMailRequestError('Microsoft Graph mail request failed', response.status, parsed);
    }

    return parsed;
  }

  async sendApplicationMail(mailPayload, sender = this.mailSender) {
    if (!sender) {
      throw new Error('Azure mail sender is not configured');
    }

    const accessToken = await this.acquireClientCredentialToken();
    const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(mailPayload)
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (error) {
      logger.error('Failed to parse Graph mail response', { error: error.message });
      parsed = text;
    }

    if (!response.ok) {
      throw new GraphMailRequestError('Microsoft Graph mail request failed', response.status, parsed);
    }

    return parsed;
  }

  async createDraft(userAssertion, draftPayload) {
    this.ensureEnabled();
    const accessToken = await this.acquireOnBehalfOfToken(userAssertion);

    const response = await fetch(GRAPH_DRAFT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(draftPayload),
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (err) {
      logger.error('Failed to parse Graph createDraft response', { error: err.message });
      parsed = text;
    }

    if (!response.ok) {
      throw new GraphMailRequestError(
        'Microsoft Graph createDraft request failed',
        response.status,
        parsed
      );
    }

    logger.info('Outlook draft created', { messageId: parsed.id });
    return parsed; // includes parsed.webLink for opening in Outlook
  }
}

export const graphMailService = new GraphMailService();
export { AzureMailNotConfiguredError, MissingUserAssertionError, GraphMailRequestError };
