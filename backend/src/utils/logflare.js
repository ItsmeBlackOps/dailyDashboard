import { config } from '../config/index.js';
import { logger } from './logger.js';

const logflareLogger = logger.child('logflare');

function buildRequestBody(eventMessage, metadata = {}) {
  return {
    event_message: eventMessage,
    metadata
  };
}

export async function sendLogflareEvent(eventMessage, metadata = {}) {
  const { logflare } = config;

  if (!logflare?.enabled) {
    logflareLogger.debug('Logflare disabled, skipping event', {
      reason: 'missing_configuration',
      eventMessage,
      metadata
    });
    return;
  }

  const url = `${logflare.endpoint}?source=${encodeURIComponent(logflare.sourceId)}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': logflare.apiKey
      },
      body: JSON.stringify(buildRequestBody(eventMessage, metadata))
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      logflareLogger.warn('Logflare request failed', {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText?.slice(0, 500),
        eventMessage
      });
    }
  } catch (error) {
    logflareLogger.error('Failed to send Logflare event', {
      error: error.message,
      eventMessage,
      metadata
    });
  }
}

export function logSuggestionDebug(message, metadata = {}) {
  void sendLogflareEvent(message, {
    ...metadata,
    logger: 'task-suggestion-debug'
  });
}

export default sendLogflareEvent;
