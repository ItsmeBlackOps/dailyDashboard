import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';

const checkMeetingConsentMock = vi.fn();
const openConsentAndPollMock = vi.fn();

vi.mock('../meetings/meetingsConsent', () => ({
  checkMeetingConsent: checkMeetingConsentMock,
  openConsentAndPoll: openConsentAndPollMock,
}));

const instance = {} as IPublicClientApplication;
const account = { homeAccountId: '1', environment: 'common', tenantId: 'tenant', username: 'user@example.com' } as AccountInfo;

const { useOnlineMeetingConsent } = await import('./useOnlineMeetingConsent');

describe('useOnlineMeetingConsent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initially checks consent status on mount', async () => {
    checkMeetingConsentMock.mockResolvedValueOnce(true);

    const { result } = renderHook(() => useOnlineMeetingConsent(instance, account));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.needsConsent).toBe(false);
    expect(checkMeetingConsentMock).toHaveBeenCalledWith(instance, account);
  });

  it('marks consent as required when check fails', async () => {
    checkMeetingConsentMock.mockResolvedValueOnce(false);

    const { result } = renderHook(() => useOnlineMeetingConsent(instance, account));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.needsConsent).toBe(true);
  });

  it('invokes consent popup when grant is called', async () => {
    checkMeetingConsentMock.mockResolvedValueOnce(false);
    openConsentAndPollMock.mockResolvedValueOnce(true);

    const { result } = renderHook(() => useOnlineMeetingConsent(instance, account));

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      const ok = await result.current.grant();
      expect(ok).toBe(true);
    });

    expect(openConsentAndPollMock).toHaveBeenCalledWith(instance, account);
    expect(result.current.needsConsent).toBe(false);
  });
});
