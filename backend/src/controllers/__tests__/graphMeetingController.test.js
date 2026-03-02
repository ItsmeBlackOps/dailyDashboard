import { jest } from '@jest/globals';

const mockCreateMeeting = jest.fn();
const mockHealth = jest.fn();
const mockCompleteConsent = jest.fn();
const mockGetConsentUrl = jest.fn();
const mockSaveMeetingLinks = jest.fn();

class AzureMeetingsNotConfiguredError extends Error {}
class MissingUserAssertionError extends Error {}
class GraphRequestError extends Error {
  constructor(message, status, responseBody) {
    super(message);
    this.status = status;
    this.responseBody = responseBody;
  }
}

jest.unstable_mockModule('../../services/graphMeetingService.js', () => ({
  graphMeetingService: {
    createMeeting: mockCreateMeeting,
    health: mockHealth,
    completeConsent: mockCompleteConsent,
    getConsentUrl: mockGetConsentUrl
  },
  AzureMeetingsNotConfiguredError,
  MissingUserAssertionError,
  GraphRequestError
}));

jest.unstable_mockModule('../../models/Task.js', () => ({
  taskModel: {
    saveMeetingLinks: mockSaveMeetingLinks
  }
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

const { graphMeetingController } = await import('../graphMeetingController.js');

function createMockResponse() {
  const res = {
    statusCode: 200,
    body: undefined
  };
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
  return res;
}

describe('graphMeetingController.createMeeting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateMeeting.mockResolvedValue({
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/default',
      joinWebUrl: 'https://teams.microsoft.com/l/meetup-join/default-web'
    });
    mockSaveMeetingLinks.mockResolvedValue({ success: true });
  });

  it('preserves existing payload behavior when lobby bypass options are not provided', async () => {
    const req = {
      headers: {
        authorization: 'Bearer token-123'
      },
      body: {
        subject: '  Team Sync  ',
        taskId: 'task-1',
        startDateTime: '2026-02-28T10:00:00-05:00',
        endDateTime: '2026-02-28T10:30:00-05:00',
        recordAutomatically: 'true'
      }
    };
    const res = createMockResponse();

    await graphMeetingController.createMeeting(req, res);

    expect(mockCreateMeeting).toHaveBeenCalledTimes(1);
    expect(mockCreateMeeting).toHaveBeenCalledWith(
      'token-123',
      expect.objectContaining({
        subject: 'Team Sync',
        startDateTime: new Date('2026-02-28T10:00:00-05:00').toISOString(),
        endDateTime: new Date('2026-02-28T10:30:00-05:00').toISOString(),
        recordAutomatically: true
      })
    );
    const [, payload] = mockCreateMeeting.mock.calls[0];
    expect(payload.lobbyBypassSettings).toBeUndefined();
    expect(mockSaveMeetingLinks).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/default',
        joinWebUrl: 'https://teams.microsoft.com/l/meetup-join/default-web'
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('supports allowEveryoneBypassLobby option and forwards lobbyBypassSettings.scope=everyone', async () => {
    const req = {
      headers: {
        authorization: 'Bearer token-123'
      },
      body: {
        subject: 'Team Sync',
        allowEveryoneBypassLobby: true
      }
    };
    const res = createMockResponse();

    await graphMeetingController.createMeeting(req, res);

    const [, payload] = mockCreateMeeting.mock.calls[0];
    expect(payload.lobbyBypassSettings).toEqual({
      scope: 'everyone'
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('accepts explicit lobbyBypassScope and isDialInBypassEnabled without affecting existing fields', async () => {
    const req = {
      headers: {
        authorization: 'Bearer token-xyz'
      },
      body: {
        subject: 'Candidate Interview',
        recordAutomatically: false,
        lobbyBypassScope: 'organization',
        isDialInBypassEnabled: 'true'
      }
    };
    const res = createMockResponse();

    await graphMeetingController.createMeeting(req, res);

    expect(mockCreateMeeting).toHaveBeenCalledWith(
      'token-xyz',
      expect.objectContaining({
        subject: 'Candidate Interview',
        recordAutomatically: false,
        lobbyBypassSettings: {
          scope: 'organization',
          isDialInBypassEnabled: true
        }
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('ignores invalid lobbyBypassScope values to avoid breaking meeting creation', async () => {
    const req = {
      headers: {
        authorization: 'Bearer token-xyz'
      },
      body: {
        subject: 'Candidate Interview',
        lobbyBypassScope: 'allUsers'
      }
    };
    const res = createMockResponse();

    await graphMeetingController.createMeeting(req, res);

    const [, payload] = mockCreateMeeting.mock.calls[0];
    expect(payload.lobbyBypassSettings).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

