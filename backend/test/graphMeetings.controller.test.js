import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const healthMock = jest.fn();
const createMeetingMock = jest.fn();
const getConsentUrlMock = jest.fn();
const completeConsentMock = jest.fn();
const saveMeetingLinksMock = jest.fn();

class AzureMeetingsNotConfiguredError extends Error {}
class MissingUserAssertionError extends Error {}
class GraphRequestError extends Error {
  constructor(message, status, responseBody) {
    super(message);
    this.status = status;
    this.responseBody = responseBody;
  }
}

await jest.resetModules();

await jest.unstable_mockModule('../src/services/graphMeetingService.js', () => ({
  graphMeetingService: {
    health: healthMock,
    createMeeting: createMeetingMock,
    getConsentUrl: getConsentUrlMock,
    completeConsent: completeConsentMock
  },
  AzureMeetingsNotConfiguredError,
  MissingUserAssertionError,
  GraphRequestError
}));

await jest.unstable_mockModule('../src/models/Task.js', () => ({
  taskModel: {
    saveMeetingLinks: saveMeetingLinksMock
  }
}));

const { graphMeetingController } = await import('../src/controllers/graphMeetingController.js');

describe('graphMeetingController', () => {
  const createRes = () => {
    const res = {};
    res.statusCode = 200;
    res.headers = {};
    res.body = undefined;
    res.status = jest.fn((code) => {
      res.statusCode = code;
      return res;
    });
    res.json = jest.fn((payload) => {
      res.body = payload;
      return res;
    });
    res.send = jest.fn((payload) => {
      res.body = payload;
      return res;
    });
    res.setHeader = jest.fn((key, value) => {
      res.headers[key] = value;
    });
    res.redirect = jest.fn((url) => {
      res.body = url;
      return res;
    });
    return res;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when bearer token is missing for health check', async () => {
    const req = { headers: {} };
    const res = createRes();

    await graphMeetingController.health(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.body).toEqual({ error: 'missing_bearer' });
    expect(healthMock).not.toHaveBeenCalled();
  });

  it('returns 503 when Azure meetings are not configured', async () => {
    const req = { headers: { authorization: 'Bearer user-token' } };
    const res = createRes();

    healthMock.mockRejectedValueOnce(new AzureMeetingsNotConfiguredError('not configured'));

    await graphMeetingController.health(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.body).toEqual({ error: 'not_configured' });
  });

  it('returns consent_required when Azure responds with consent error', async () => {
    const req = { headers: { authorization: 'Bearer user-token' } };
    const res = createRes();

    healthMock.mockRejectedValueOnce(new Error('AADSTS65001: consent required'));

    await graphMeetingController.health(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual({ error: 'consent_required' });
  });

  it('sanitizes meeting payload before calling the service', async () => {
    const req = {
      headers: { authorization: 'Bearer user-token' },
      body: {
        subject: '  <script>alert("x")</script> Standup  ',
        startDateTime: '2024-06-01T10:00:00Z',
        endDateTime: '2024-06-01T10:30:00Z'
      }
    };
    const res = createRes();
    const fakeMeeting = { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' };
    createMeetingMock.mockResolvedValueOnce(fakeMeeting);

    await graphMeetingController.createMeeting(req, res);

    expect(createMeetingMock).toHaveBeenCalledWith('user-token', {
      subject: 'alert("x") Standup',
      startDateTime: '2024-06-01T10:00:00.000Z',
      endDateTime: '2024-06-01T10:30:00.000Z'
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body).toEqual({ meeting: fakeMeeting, joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc', joinWebUrl: '' });
    expect(saveMeetingLinksMock).not.toHaveBeenCalled();
  });

  it('passes sanitized recordAutomatically flag to the meeting payload', async () => {
    const req = {
      headers: { authorization: 'Bearer user-token' },
      body: {
        subject: 'Status Update',
        recordAutomatically: 'yes',
        startDateTime: '2024-07-01T14:00:00Z'
      }
    };
    const res = createRes();
    createMeetingMock.mockResolvedValueOnce({});

    await graphMeetingController.createMeeting(req, res);

    expect(createMeetingMock).toHaveBeenCalledWith('user-token', {
      subject: 'Status Update',
      startDateTime: '2024-07-01T14:00:00.000Z',
      recordAutomatically: true
    });
  });

  it('returns graph_error when GraphRequestError is thrown', async () => {
    const req = {
      headers: { authorization: 'Bearer token' },
      body: { subject: 'Meeting' }
    };
    const res = createRes();

    const detail = { message: 'Bad Request' };
    createMeetingMock.mockRejectedValueOnce(new GraphRequestError('bad request', 400, detail));

    await graphMeetingController.createMeeting(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual({ error: 'graph_error', detail });
  });

  it('persists meeting links when taskId provided', async () => {
    const req = {
      headers: { authorization: 'Bearer token' },
      body: {
        subject: 'Sync',
        taskId: '656f8a4f0b5f5a4bf8b12345'
      }
    };
    const res = createRes();
    const meeting = {
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/123',
      joinWebUrl: 'https://teams.microsoft.com/web/123'
    };
    createMeetingMock.mockResolvedValueOnce(meeting);
    saveMeetingLinksMock.mockResolvedValueOnce({ matchedCount: 1 });

    await graphMeetingController.createMeeting(req, res);

    expect(saveMeetingLinksMock).toHaveBeenCalledWith('656f8a4f0b5f5a4bf8b12345', {
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/123',
      joinWebUrl: 'https://teams.microsoft.com/web/123'
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body.joinUrl).toBe('https://teams.microsoft.com/l/meetup-join/123');
    expect(res.body.joinWebUrl).toBe('https://teams.microsoft.com/web/123');
  });

  it('returns 500 when meeting links cannot be persisted', async () => {
    const req = {
      headers: { authorization: 'Bearer token' },
      body: {
        subject: 'Sync',
        taskId: '656f8a4f0b5f5a4bf8b12345'
      }
    };
    const res = createRes();
    const meeting = {
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/123'
    };
    createMeetingMock.mockResolvedValueOnce(meeting);
    saveMeetingLinksMock.mockRejectedValueOnce(new Error('failed to update'));

    await graphMeetingController.createMeeting(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.body).toEqual({
      error: 'persist_failed',
      detail: 'failed to update',
      meeting
    });
  });
});
