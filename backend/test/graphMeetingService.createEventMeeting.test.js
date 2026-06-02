import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { graphMeetingService } from '../src/services/graphMeetingService.js';

const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; jest.restoreAllMocks(); });

describe('graphMeetingService.createEventMeeting', () => {
  it('OBO-exchanges the assertion, POSTs the event to /me/events, and returns the parsed body', async () => {
    jest.spyOn(graphMeetingService, 'acquireOnBehalfOfToken').mockResolvedValue('graph-token');
    const payload = { subject: 'Interview', isOnlineMeeting: true };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ id: 'evt1', onlineMeeting: { joinUrl: 'https://teams/x' } }),
    });

    const result = await graphMeetingService.createEventMeeting('assertion-token', payload);

    expect(graphMeetingService.acquireOnBehalfOfToken)
      .toHaveBeenCalledWith('assertion-token', graphMeetingService.scopes);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/events');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer graph-token');
    expect(JSON.parse(opts.body)).toEqual(payload);
    expect(result.onlineMeeting.joinUrl).toBe('https://teams/x');
  });

  it('throws on a non-OK Graph response', async () => {
    jest.spyOn(graphMeetingService, 'acquireOnBehalfOfToken').mockResolvedValue('graph-token');
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 403, text: async () => JSON.stringify({ error: 'denied' }),
    });
    await expect(graphMeetingService.createEventMeeting('a', {})).rejects.toThrow();
  });
});
