process.env.FIREFLIES_API_KEY = 'test-key';
process.env.FIREFLIES_COOLDOWN_CAP_MS = String(60 * 60 * 1000);
const { firefliesService } = await import('../firefliesService.js');

beforeEach(() => {
  firefliesService._rateLimitedUntil = 0;
  firefliesService._inviteRateLimitedUntil = 0;
});

describe('scoped rate-limit clocks', () => {
  it('a read-path 429 blocks reads but NOT invites', () => {
    firefliesService._applyRateLimit(Date.now() + 10 * 60_000, 'graphql-too-many-requests', 'read');
    expect(firefliesService.isRateLimited('read')).toBe(true);
    expect(firefliesService.isRateLimited('invite')).toBe(false);
  });

  it('an invite-path 429 blocks both clocks', () => {
    firefliesService._applyRateLimit(Date.now() + 10 * 60_000, 'graphql-too-many-requests', 'invite');
    expect(firefliesService.isRateLimited('read')).toBe(true);
    expect(firefliesService.isRateLimited('invite')).toBe(true);
  });

  it('caps an absurd retry-after (e.g. next midnight) at FIREFLIES_COOLDOWN_CAP_MS', () => {
    firefliesService._applyRateLimit(Date.now() + 24 * 60 * 60_000, 'http-429', 'invite');
    const until = firefliesService.getRateLimitedUntil('invite');
    expect(until - Date.now()).toBeLessThanOrEqual(60 * 60_000 + 1000);
  });

  it('isRateLimited() defaults to the read clock (back-compat for existing callers)', () => {
    firefliesService._applyRateLimit(Date.now() + 60_000, 'x', 'read');
    expect(firefliesService.isRateLimited()).toBe(true);
  });
});
