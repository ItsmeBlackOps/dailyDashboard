import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const authFetch = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ authFetch }), API_URL: '' }));
const parseJsonOrThrow = vi.fn();
vi.mock('@/lib/fetchJson', () => ({ parseJsonOrThrow: (...a: unknown[]) => parseJsonOrThrow(...a) }));

import { MarketingMeetingAckModal } from '../MarketingMeetingAckModal';

beforeEach(() => { vi.clearAllMocks(); authFetch.mockResolvedValue({}); });
afterEach(cleanup);

describe('MarketingMeetingAckModal', () => {
  it('does not render the dialog when not required', async () => {
    parseJsonOrThrow.mockResolvedValueOnce({ required: false, currentVersion: 1, agreedVersion: 1 });
    render(<MarketingMeetingAckModal />);
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(screen.queryByText(/Meeting status indicator/i)).toBeNull();
  });

  it('renders when required; Submit disabled until checkbox; PATCH on submit', async () => {
    parseJsonOrThrow
      .mockResolvedValueOnce({ required: true, currentVersion: 1, agreedVersion: 0 })
      .mockResolvedValueOnce({ success: true });
    render(<MarketingMeetingAckModal />);
    const submit = await screen.findByRole('button', { name: /submit/i });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(authFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/users/me/marketing-meeting-acknowledgment'),
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ version: 1 }) })
      )
    );
  });
});
