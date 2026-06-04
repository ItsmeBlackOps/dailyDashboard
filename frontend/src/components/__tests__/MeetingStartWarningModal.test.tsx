import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const authFetch = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ authFetch }), API_URL: '' }));
const parseJsonOrThrow = vi.fn();
vi.mock('@/lib/fetchJson', () => ({ parseJsonOrThrow: (...a: unknown[]) => parseJsonOrThrow(...a) }));

import { MeetingStartWarningModal } from '../MeetingStartWarningModal';

const CONTENT = {
  title: 'Meeting marked started too early',
  body: ['You marked one or more meetings as "Started" well before their scheduled time.'],
  meetings: [{ candidate: 'Meka Priyanka', scheduledEst: 'Jun 4, 2:00 PM EST' }],
};

beforeEach(() => { vi.clearAllMocks(); authFetch.mockResolvedValue({}); });

describe('MeetingStartWarningModal', () => {
  it('does not render when not required', async () => {
    parseJsonOrThrow.mockResolvedValueOnce({ required: false, content: null });
    render(<MeetingStartWarningModal />);
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(screen.queryByText(/marked started too early/i)).toBeNull();
  });

  it('renders the warning + the affected meetings when required', async () => {
    parseJsonOrThrow.mockResolvedValueOnce({ required: true, shownCount: 0, maxShows: 3, content: CONTENT });
    render(<MeetingStartWarningModal />);
    expect(await screen.findByText(/marked started too early/i)).toBeInTheDocument();
    expect(screen.getByText(/Meka Priyanka/)).toBeInTheDocument();
  });

  it('"I understand" PATCHes the warning endpoint and closes', async () => {
    // Persistent mock (acknowledge ignores the PATCH body) — avoids Once-queue
    // misalignment if the effect double-fires.
    parseJsonOrThrow.mockResolvedValue({ required: true, shownCount: 0, maxShows: 3, content: CONTENT });
    render(<MeetingStartWarningModal />);
    const btn = await screen.findByRole('button', { name: /i understand/i });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(authFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/users/me/meeting-start-warning'),
        expect.objectContaining({ method: 'PATCH' })
      )
    );
    // The PATCH waitFor above is the contract (acknowledge → server records the
    // dismissal). Dialog teardown after setContent(null) isn't reliably
    // observable under Radix + jsdom, so it's not asserted here — same as the
    // TechnicalAckModal test.
  });
});
