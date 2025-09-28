import { describe, it, beforeAll, afterAll, afterEach, expect, jest } from '@jest/globals';
import { setupSocketTestHarness, SOCKET_TEST_CONFIG } from './helpers/socketTestHarness.js';

jest.setTimeout(30000);

describe('Socket Authentication Flow', () => {
  let harness;
  let emit;
  let issuedTokens = null;

  beforeAll(async () => {
    harness = await setupSocketTestHarness();
    emit = harness.emitWithAck;
  });

  afterEach(async () => {
    if (issuedTokens?.refreshToken) {
      await emit('logout', { refreshToken: issuedTokens.refreshToken });
      issuedTokens = null;
    }
  });

  afterAll(async () => {
    if (harness) {
      await harness.shutdown();
    }
  });

  it('authenticates valid credentials and returns tokens', async () => {
    const response = await emit('login', SOCKET_TEST_CONFIG.credentials);

    expect(response.success).toBe(true);
    expect(response.accessToken).toBeDefined();
    expect(response.refreshToken).toBeDefined();
    expect(response.role).toBe('admin');
    expect(response.teamLead).toBe('Lead A');
    expect(response.manager).toBe('Manager A');

    issuedTokens = response;
  });

  it('rejects invalid passwords for the same user', async () => {
    const response = await emit('login', {
      ...SOCKET_TEST_CONFIG.credentials,
      password: 'incorrect-password'
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe('Invalid credentials');
  });

  it('refreshes the access token using the issued refresh token', async () => {
    const loginResponse = await emit('login', SOCKET_TEST_CONFIG.credentials);
    issuedTokens = loginResponse;

    const refreshResponse = await emit('refresh', {
      refreshToken: loginResponse.refreshToken
    });

    expect(refreshResponse.success).toBe(true);
    expect(typeof refreshResponse.accessToken).toBe('string');
    expect(refreshResponse.accessToken.length).toBeGreaterThan(0);
  });

  it('logs out and invalidates the refresh token', async () => {
    const loginResponse = await emit('login', SOCKET_TEST_CONFIG.credentials);
    issuedTokens = loginResponse;

    const logoutResponse = await emit('logout', {
      refreshToken: loginResponse.refreshToken
    });

    expect(logoutResponse.success).toBe(true);
    expect(logoutResponse.message).toBe('Logged out successfully');

    // Attempt to refresh after logout should fail
    const refreshAfterLogout = await emit('refresh', {
      refreshToken: loginResponse.refreshToken
    });

    expect(refreshAfterLogout.success).toBe(false);
    expect(refreshAfterLogout.error).toBe('Invalid refresh token');

    issuedTokens = null;
  });
  });
