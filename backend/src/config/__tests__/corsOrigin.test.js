import { jest } from '@jest/globals';

process.env.FRONTEND_ORIGIN = 'https://dailydf.silverspace.tech';

const { config } = await import('../index.js');

const decide = (origin) =>
  new Promise((resolve) => {
    config.cors.origin(origin, (err, allow) => resolve({ err, allow: allow === true }));
  });

describe('CORS origin callback', () => {
  it('allows requests with no Origin header (curl, server-to-server)', async () => {
    const { err, allow } = await decide(undefined);
    expect(err).toBeNull();
    expect(allow).toBe(true);
  });

  it('allows the configured frontend origin', async () => {
    const { err, allow } = await decide('https://dailydf.silverspace.tech');
    expect(err).toBeNull();
    expect(allow).toBe(true);
  });

  it.each([
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
    'moz-extension://0b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e',
    'safari-web-extension://ABCDEF01-2345-6789-ABCD-EF0123456789',
    'ms-browser-extension://abcdefghijklmnop',
  ])('allows browser-extension origins (%s)', async (origin) => {
    const { err, allow } = await decide(origin);
    expect(err).toBeNull();
    expect(allow).toBe(true);
  });

  it('rejects unknown web origins with a 403-coded error, not a 500-defaulting one', async () => {
    const { err } = await decide('https://evil.example.com');
    expect(err).toBeTruthy();
    expect(err.statusCode).toBe(403);
  });
});
