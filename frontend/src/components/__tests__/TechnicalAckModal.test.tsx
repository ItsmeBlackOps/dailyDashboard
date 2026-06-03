import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const authFetch = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ authFetch }), API_URL: '' }));
const parseJsonOrThrow = vi.fn();
vi.mock('@/lib/fetchJson', () => ({ parseJsonOrThrow: (...a: unknown[]) => parseJsonOrThrow(...a) }));

import { TechnicalAckModal } from '../TechnicalAckModal';

beforeEach(() => { vi.clearAllMocks(); authFetch.mockResolvedValue({}); });

describe('TechnicalAckModal', () => {
  it('does not render the dialog when not required', async () => {
    parseJsonOrThrow.mockResolvedValueOnce({ required: false, content: null });
    render(<TechnicalAckModal />);
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(screen.queryByText(/Before You Start Meetings/i)).toBeNull();
  });

  it('renders when required; Submit disabled until checkbox; PATCH on submit', async () => {
    parseJsonOrThrow
      .mockResolvedValueOnce({ required: true, content: { version: 1, title: 'Technical Team — Before You Start Meetings', sections: ['A', 'B'] } })
      .mockResolvedValueOnce({ success: true });
    render(<TechnicalAckModal />);
    const submit = await screen.findByRole('button', { name: /agree & submit/i });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() =>
      expect(authFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/users/me/technical-acknowledgment'),
        expect.objectContaining({ method: 'PATCH' })
      )
    );
  });
});
