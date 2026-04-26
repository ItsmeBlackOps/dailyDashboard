import { jest } from '@jest/globals';

// Mock config before importing the service
jest.unstable_mockModule('../../config/index.js', () => ({
  config: {
    fireflies: {
      apiKey: 'test-api-key',
      graphqlUrl: 'https://api.fireflies.ai/graphql',
    },
  },
}));

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const { firefliesService, FirefliesNotConfiguredError, FirefliesRequestError } = await import('../firefliesService.js');

function mockFetch(overrides = {}) {
  const defaults = {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ data: {} })),
  };
  return jest.fn().mockResolvedValue({ ...defaults, ...overrides });
}

describe('firefliesService', () => {
  afterEach(() => {
    delete global.fetch;
    jest.clearAllMocks();
  });

  describe('inviteBot', () => {
    it('sends correct GraphQL mutation body and returns success + message', async () => {
      global.fetch = mockFetch({
        text: () => Promise.resolve(JSON.stringify({
          data: {
            addToLiveMeeting: { success: true, message: 'Bot invited successfully' },
          },
        })),
      });

      const result = await firefliesService.inviteBot({
        meetingLink: 'https://meet.google.com/abc-def-ghi',
        title: 'Team Sync',
        duration: 60,
        password: null,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.fireflies.ai/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('addToLiveMeeting'),
        })
      );

      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.variables.meeting_link).toBe('https://meet.google.com/abc-def-ghi');
      expect(body.variables.title).toBe('Team Sync');
      expect(body.variables.duration).toBe(60);

      expect(result).toEqual({ success: true, message: 'Bot invited successfully' });
    });

    it('throws FirefliesNotConfiguredError when no API key', async () => {
      const originalKey = firefliesService.apiKey;
      const originalEnabled = firefliesService.enabled;
      firefliesService.apiKey = '';
      firefliesService.enabled = false;

      await expect(
        firefliesService.inviteBot({ meetingLink: 'https://meet.google.com/x', title: 'Test' })
      ).rejects.toBeInstanceOf(FirefliesNotConfiguredError);

      firefliesService.apiKey = originalKey;
      firefliesService.enabled = originalEnabled;
    });

    it('throws FirefliesRequestError with status + responseBody on non-200', async () => {
      global.fetch = mockFetch({
        ok: false,
        status: 401,
        text: () => Promise.resolve(JSON.stringify({ error: 'Unauthorized' })),
      });

      const err = await firefliesService
        .inviteBot({ meetingLink: 'https://meet.google.com/x', title: 'T' })
        .catch(e => e);

      expect(err).toBeInstanceOf(FirefliesRequestError);
      expect(err.status).toBe(401);
      expect(err.responseBody).toMatchObject({ error: 'Unauthorized' });
    });
  });

  describe('getActiveMeetings', () => {
    it('handles successful response with array of meetings', async () => {
      const meetings = [
        { id: 'meet-1', meeting_link: 'https://meet.google.com/aaa', title: 'Daily Standup', meeting_id: 'mid-1' },
        { id: 'meet-2', meeting_link: 'https://zoom.us/j/12345', title: 'Interview', meeting_id: 'mid-2' },
      ];
      global.fetch = mockFetch({
        text: () => Promise.resolve(JSON.stringify({ data: { active_meetings: meetings } })),
      });

      const result = await firefliesService.getActiveMeetings();
      expect(result).toEqual(meetings);
    });

    it('falls back to __typename-only query if first query errors with unknown field message', async () => {
      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(JSON.stringify({
              errors: [{ message: 'unknown field: meeting_id' }],
            })),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify({
            data: { active_meetings: [{ __typename: 'Meeting' }] },
          })),
        });
      });

      const result = await firefliesService.getActiveMeetings();
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual([{ __typename: 'Meeting' }]);
    });
  });

  describe('isBotInMeeting', () => {
    it('returns true when meeting is in active list', async () => {
      global.fetch = mockFetch({
        text: () => Promise.resolve(JSON.stringify({
          data: {
            active_meetings: [
              { meeting_link: 'https://meet.google.com/abc-def-ghi' },
            ],
          },
        })),
      });

      const result = await firefliesService.isBotInMeeting('https://meet.google.com/abc-def-ghi');
      expect(result).toBe(true);
    });

    it('returns false when meeting is not in active list', async () => {
      global.fetch = mockFetch({
        text: () => Promise.resolve(JSON.stringify({
          data: { active_meetings: [{ meeting_link: 'https://meet.google.com/xyz' }] },
        })),
      });

      const result = await firefliesService.isBotInMeeting('https://zoom.us/j/99999');
      expect(result).toBe(false);
    });

    it('returns false when meetingLink is falsy', async () => {
      const result = await firefliesService.isBotInMeeting('');
      expect(result).toBe(false);
    });

    it('performs case-insensitive match and works with URL query params', async () => {
      global.fetch = mockFetch({
        text: () => Promise.resolve(JSON.stringify({
          data: {
            active_meetings: [
              { meeting_link: 'https://meet.google.com/abc-def-ghi' },
            ],
          },
        })),
      });

      // URL with query params still matches base URL via substring match
      const result = await firefliesService.isBotInMeeting('HTTPS://MEET.GOOGLE.COM/ABC-DEF-GHI?authuser=0');
      expect(result).toBe(true);
    });
  });
});
