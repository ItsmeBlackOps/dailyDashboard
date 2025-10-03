import {
  graphMailService,
  AzureMailNotConfiguredError,
  MissingUserAssertionError,
  GraphMailRequestError
} from '../services/graphMailService.js';
import { logger } from '../utils/logger.js';

function bearerFrom(req) {
  const header = req.headers?.authorization || '';
  const match = /^Bearer\s+(.+)/i.exec(header);
  return match ? match[1] : '';
}

function normalizeMailPayload(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be an object');
    error.statusCode = 400;
    throw error;
  }

  const { message, saveToSentItems = true } = body;
  if (!message || typeof message !== 'object') {
    const error = new Error('Field "message" is required');
    error.statusCode = 400;
    throw error;
  }

  if (!Array.isArray(message.toRecipients) || message.toRecipients.length === 0) {
    const error = new Error('At least one toRecipient is required');
    error.statusCode = 400;
    throw error;
  }

  return {
    message,
    saveToSentItems: Boolean(saveToSentItems)
  };
}

export const graphMailController = {
  async sendMail(req, res) {
    const bearer = bearerFrom(req);
    if (!bearer) {
      return res.status(401).json({
        success: false,
        error: 'missing_bearer'
      });
    }

    let payload;
    try {
      payload = normalizeMailPayload(req.body);
    } catch (error) {
      const status = typeof error.statusCode === 'number' ? error.statusCode : 400;
      return res.status(status).json({
        success: false,
        error: error.message
      });
    }

    try {
      await graphMailService.sendMail(bearer, payload);
      return res.status(202).json({
        success: true,
        message: 'Mail submitted to Microsoft Graph'
      });
    } catch (error) {
      if (error instanceof AzureMailNotConfiguredError) {
        return res.status(503).json({ success: false, error: 'not_configured' });
      }
      if (error instanceof MissingUserAssertionError) {
        return res.status(401).json({ success: false, error: 'missing_bearer' });
      }
      if (error instanceof GraphMailRequestError) {
        logger.error('Graph mail request failed', {
          status: error.status,
          response: error.responseBody
        });
        return res.status(error.status || 502).json({
          success: false,
          error: 'graph_mail_error',
          details: error.responseBody
        });
      }
      logger.error('Unexpected error while sending Graph mail', { error: error.message });
      return res.status(500).json({ success: false, error: 'internal_error' });
    }
  }
};
