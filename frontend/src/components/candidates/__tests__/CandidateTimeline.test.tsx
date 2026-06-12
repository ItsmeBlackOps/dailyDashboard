/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
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

  it('makes interview events clickable (task id) but not other sources', async () => {
    const WITH_INTERVIEW = [
      ...TIMELINE,
      {
        id: '6a299621edd160ce6e3b32e5',
        ts: '2026-06-03T15:30:00Z',
        type: 'interview',
        label: 'Interview 2nd round with Acme',
        actor: 'recruiter@x.com',
        source: 'interview',
      },
    ];
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, timeline: WITH_INTERVIEW }),
    });
    const onTaskClick = vi.fn();

    render(<CandidateTimeline candidateId="cand-3" onTaskClick={onTaskClick} />);

    await waitFor(() =>
      expect(screen.getByText('Interview 2nd round with Acme')).toBeInTheDocument(),
    );

    // The interview row is the only button — its id is the taskBody _id.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(onTaskClick).toHaveBeenCalledWith('6a299621edd160ce6e3b32e5');

    // Clicking a non-task row does nothing.
    fireEvent.click(screen.getByText('Status: New → Active'));
    expect(onTaskClick).toHaveBeenCalledTimes(1);
  });

  it('shows the typed note under call activities (and skips note-as-label duplicates)', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        timeline: [
          {
            id: 'a1',
            ts: '2026-06-04T10:00:00Z',
            type: 'call_attempt',
            label: 'Call attempt — connected',
            actor: 'rec@x.com',
            detail: { outcome: 'connected', notes: 'Asked to reschedule to Friday after 6pm' },
            source: 'activity',
          },
          {
            id: 'a2',
            ts: '2026-06-04T09:00:00Z',
            type: 'document_prepared',
            // Non-call activities use the note AS the label — must not render twice.
            label: 'Resume v3 shared with vendor',
            detail: { outcome: null, notes: 'Resume v3 shared with vendor' },
            source: 'activity',
          },
        ],
      }),
    });

    render(<CandidateTimeline candidateId="cand-5" />);

    await waitFor(() =>
      expect(screen.getByText('Call attempt — connected')).toBeInTheDocument(),
    );
    expect(screen.getByText('Asked to reschedule to Friday after 6pm')).toBeInTheDocument();
    // The duplicate-label note renders exactly once.
    expect(screen.getAllByText('Resume v3 shared with vendor')).toHaveLength(1);
  });

  it('renders no buttons when onTaskClick is not provided', async () => {
    authFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        timeline: [
          {
            id: 'task-1',
            ts: '2026-06-03T15:30:00Z',
            type: 'interview',
            label: 'Interview with Acme',
            source: 'interview',
          },
        ],
      }),
    });

    render(<CandidateTimeline candidateId="cand-4" />);

    await waitFor(() =>
      expect(screen.getByText('Interview with Acme')).toBeInTheDocument(),
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
