/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CandidateTimeline } from '../CandidateTimeline';

// authFetch is built inside useAuth from auth context + localStorage; mock it
// so the component's timeline fetch is fully controlled by the test.
const authFetchMock = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  API_URL: 'http://localhost:3004',
  useAuth: () => ({ authFetch: authFetchMock }),
}));

// jsdom lacks ResizeObserver; shim it in case any nested primitive needs it.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const TIMELINE = [
  {
    id: '1',
    ts: '2026-06-02T09:00:00Z',
    type: 'assignment_email',
    label: 'Assignment email sent to rec@x.com',
    actor: 'mm@x.com',
    source: 'assignmentEmails',
  },
  {
    id: '2',
    ts: '2026-06-01T11:00:00Z',
    type: 'status_changed',
    label: 'Status: New → Active',
    actor: 'mm@x.com',
    source: 'statusHistory',
  },
];

describe('CandidateTimeline — unified feed', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  // No global afterEach is configured (vitest globals default); clean up so a
  // prior render does not leak into the next test's DOM queries.
  afterEach(() => {
    cleanup();
  });

  it('renders every event label and keeps the newest event first', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, timeline: TIMELINE }),
    });

    render(<CandidateTimeline candidateId="cand-1" />);

    // Both labels render.
    await waitFor(() =>
      expect(screen.getByText('Assignment email sent to rec@x.com')).toBeInTheDocument(),
    );
    expect(screen.getByText('Status: New → Active')).toBeInTheDocument();

    // Newest-first: the assignment email (2026-06-02) renders before the
    // status change (2026-06-01) in document order.
    const labels = screen.getAllByText(/Assignment email sent to rec@x\.com|Status: New → Active/);
    expect(labels[0]).toHaveTextContent('Assignment email sent to rec@x.com');

    // It fetched the timeline endpoint for the given candidate.
    const [url] = authFetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/candidates/cand-1/timeline');
  });

  it('shows an empty state when the timeline is empty', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, timeline: [] }),
    });

    render(<CandidateTimeline candidateId="cand-2" />);

    await waitFor(() =>
      expect(screen.getByText(/no timeline events/i)).toBeInTheDocument(),
    );
  });
});
