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

const LOBBY_BYPASS_SCOPES = new Set([
  'organizer',
  'organization',
  'organizationAndFederated',
  'everyone',
  'invited',
  'organizationExcludingGuests'
]);

function parseOptionalBoolean(value) {
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

function normalizeLobbyBypassScope(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return LOBBY_BYPASS_SCOPES.has(trimmed) ? trimmed : undefined;
}

function parseLobbyBypassSettings(body) {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const nestedSettings =
    body.lobbyBypassSettings && typeof body.lobbyBypassSettings === 'object'
      ? body.lobbyBypassSettings
      : {};

  let scope = normalizeLobbyBypassScope(body.lobbyBypassScope);
  if (!scope) {
    scope = normalizeLobbyBypassScope(nestedSettings.scope);
  }

  const allowEveryone = parseOptionalBoolean(body.allowEveryoneBypassLobby);
  if (!scope && allowEveryone === true) {
    scope = 'everyone';
  }

  let isDialInBypassEnabled = parseOptionalBoolean(body.isDialInBypassEnabled);
  if (typeof isDialInBypassEnabled !== 'boolean') {
    isDialInBypassEnabled = parseOptionalBoolean(nestedSettings.isDialInBypassEnabled);
  }

  if (!scope && typeof isDialInBypassEnabled !== 'boolean') {
    return undefined;
  }

  const settings = {};
  if (scope) {
    settings.scope = scope;
  }
  if (typeof isDialInBypassEnabled === 'boolean') {
    settings.isDialInBypassEnabled = isDialInBypassEnabled;
  }

  return settings;
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
    const recordAutomatically = parseOptionalBoolean(req.body?.recordAutomatically);
    if (typeof recordAutomatically === 'boolean') {
      payload.recordAutomatically = recordAutomatically;
    }
    // Default the lobby bypass to "everyone" so the Fireflies recording
    // bot — which joins via the meeting link as an external/anonymous
    // participant — is auto-admitted instead of waiting in the lobby.
    // Without this the tenant default keeps the bot in the lobby and the
    // meeting is never transcribed. Callers can still override the scope
    // via lobbyBypassScope / lobbyBypassSettings / allowEveryoneBypassLobby.
    const lobbyBypassSettings = parseLobbyBypassSettings(req.body)
      || { scope: 'everyone', isDialInBypassEnabled: true };
    payload.lobbyBypassSettings = lobbyBypassSettings;

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
  },

  // Set an existing Teams meeting's lobby to everyone-bypass (+ auto-record)
  // by its join URL. Called after the calendar event creates its native
  // meeting, so the Fireflies bot (invited to the event) is auto-admitted.
  async bypassLobby(req, res) {
    const token = bearerFrom(req);
    if (!token) {
      return res.status(401).json({ error: 'missing_bearer' });
    }

    const joinWebUrl = typeof req.body?.joinWebUrl === 'string' ? req.body.joinWebUrl.trim() : '';
    if (!joinWebUrl) {
      return res.status(400).json({ error: 'missing_join_url' });
    }

    try {
      const meeting = await graphMeetingService.setMeetingLobbyBypass(token, joinWebUrl);
      return res.status(200).json({ success: true, meeting });
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
      logger.error('Failed to set meeting lobby bypass', { error: error.message });
      return res.status(500).json({ error: 'bypass_failed', detail: error?.message });
    }
  }
};
