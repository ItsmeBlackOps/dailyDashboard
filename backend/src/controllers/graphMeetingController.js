import { graphMeetingService, AzureMeetingsNotConfiguredError, MissingUserAssertionError, GraphRequestError } from '../services/graphMeetingService.js';
import { taskModel } from '../models/Task.js';
import { logger } from '../utils/logger.js';

const consentCompleteHtml = `<!doctype html>
<meta charset="utf-8" />
<title>Consent Complete</title>
<p>Consent complete. You may close this window.</p>
<script>try { window.close(); } catch(e) {}</script>`;

function bearerFrom(req) {
  const header = req.headers?.authorization || '';
  const match = /^Bearer\s+(.+)/i.exec(header);
  return match ? match[1] : '';
}

function sanitizeSubject(raw) {
  if (typeof raw !== 'string') {
    return 'Meeting';
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return 'Meeting';
  }
  const withoutTags = trimmed.replace(/<[^>]*>/g, '');
  const cleaned = withoutTags.replace(/[\r\n]/g, '').trim();
  return cleaned ? cleaned.slice(0, 256) : 'Meeting';
}

function sanitizeIsoDate(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return new Date(parsed).toISOString();
}

function normalizeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  try {
    const url = new URL(value.trim());
    return url.toString();
  } catch (error) {
    logger.warn('Discarding invalid meeting URL', { value });
    return '';
  }
}

function parseRecordAutomatically(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

export const graphMeetingController = {
  async startConsent(req, res) {
    try {
      const state = typeof req.query?.state === 'string' ? req.query.state : 'meetings';
      const url = await graphMeetingService.getConsentUrl(state);
      res.redirect(url);
    } catch (error) {
      if (error instanceof AzureMeetingsNotConfiguredError) {
        return res.status(503).send('Azure meetings integration is not configured');
      }
      logger.error('Failed to initiate Azure consent', { error: error.message });
      return res.status(500).send(`Failed to initiate consent: ${error?.message || error}`);
    }
  },

  async handleRedirect(req, res) {
    try {
      const code = typeof req.query?.code === 'string' ? req.query.code : '';
      await graphMeetingService.completeConsent(code);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(consentCompleteHtml);
    } catch (error) {
      logger.error('Azure consent redirect failed', { error: error.message });
      res.status(500).send(`Consent error: ${error?.message || error}`);
    }
  },

  async health(req, res) {
    const token = bearerFrom(req);
    if (!token) {
      return res.status(401).json({ error: 'missing_bearer' });
    }

    try {
      await graphMeetingService.health(token);
      return res.json({ status: 'ok' });
    } catch (error) {
      if (error instanceof AzureMeetingsNotConfiguredError) {
        return res.status(503).json({ error: 'not_configured' });
      }
      if (error instanceof MissingUserAssertionError) {
        return res.status(401).json({ error: 'missing_bearer' });
      }
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('aadsts65001') || message.includes('consent')) {
        return res.status(403).json({ error: 'consent_required' });
      }
      logger.error('Azure meetings health check failed', { error: error.message });
      return res.status(500).json({ error: 'check_failed', detail: error?.message });
    }
  },

  async createMeeting(req, res) {
    const token = bearerFrom(req);
    if (!token) {
      return res.status(401).json({ error: 'missing_bearer' });
    }

    const subject = sanitizeSubject(req.body?.subject);
    const rawTaskId = typeof req.body?.taskId === 'string' ? req.body.taskId.trim() : '';
    const startDateTime = sanitizeIsoDate(req.body?.startDateTime);
    const endDateTime = sanitizeIsoDate(req.body?.endDateTime);

    const payload = { subject };
    if (startDateTime) {
      payload.startDateTime = startDateTime;
    }
    if (endDateTime) {
      payload.endDateTime = endDateTime;
    }
    const recordAutomatically = parseRecordAutomatically(req.body?.recordAutomatically);
    if (typeof recordAutomatically === 'boolean') {
      payload.recordAutomatically = recordAutomatically;
    }

    try {
      const meeting = await graphMeetingService.createMeeting(token, payload);

      const joinUrl = normalizeUrl(meeting?.joinUrl);
      const joinWebUrl = normalizeUrl(meeting?.joinWebUrl);

      if (rawTaskId && (joinUrl || joinWebUrl)) {
        try {
          await taskModel.saveMeetingLinks(rawTaskId, { joinUrl, joinWebUrl });
        } catch (persistError) {
          logger.error('Failed to store meeting links on task', {
            taskId: rawTaskId,
            error: persistError.message,
          });
          return res.status(500).json({
            error: 'persist_failed',
            detail: persistError.message,
            meeting,
          });
        }
      }

      return res.status(201).json({ meeting, joinUrl, joinWebUrl, taskId: rawTaskId || undefined });
    } catch (error) {
      if (error instanceof AzureMeetingsNotConfiguredError) {
        return res.status(503).json({ error: 'not_configured' });
      }
      if (error instanceof MissingUserAssertionError) {
        return res.status(401).json({ error: 'missing_bearer' });
      }
      if (error instanceof GraphRequestError) {
        const detail = error.responseBody || { message: error.message };
        return res.status(error.status || 502).json({ error: 'graph_error', detail });
      }

      logger.error('Failed to create Teams meeting', { error: error.message });
      return res.status(500).json({ error: 'create_failed', detail: error?.message });
    }
  }
};
