/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { UpcomingInterviews, relativeLabel } from '../UpcomingInterviews';

const authFetchMock = vi.fn();
let mockRole = 'mm';
vi.mock('@/hooks/useAuth', () => ({
  API_URL: 'http://localhost:3004',
  useAuth: () => ({ authFetch: authFetchMock, user: { role: mockRole, email: 'x@x.com' } }),
}));

// TaskSheet pulls router + Radix; stub it so this test stays on the strip.
vi.mock('@/components/shared/TaskSheet', () => ({
  TaskSheet: ({ taskId }: { taskId: string | null }) =>
    taskId ? <div data-testid="task-sheet">{taskId}</div> : null,
}));

function mockTasks(tasks: unknown[]) {
  authFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, tasks }),
  });
}

const TASK = (overrides: Record<string, unknown> = {}) => ({
  taskId: 't-1',
  candidateName: 'Janavi Soni',
  role: 'Tax Preparer',
  client: 'Acme',
  round: '2nd',
  status: 'pending',
  interviewStartAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  interviewStartEst: '3:30 PM',
  assignedTo: 'darshan.singh@vizvainc.com',
  hasMeetingLink: true,
  ...overrides,
});

describe('UpcomingInterviews — dashboard strip', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    mockRole = 'mm';
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when no tasks are in the window', async () => {
    mockTasks([]);
    const { container } = render(<UpcomingInterviews />);
    await waitFor(() => expect(authFetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows unstarted tasks with a countdown for marketing roles — no blinking', async () => {
    mockTasks([TASK()]);
    render(<UpcomingInterviews />);

    expect(await screen.findByText(/Janavi Soni/)).toBeInTheDocument();
    expect(screen.getByText('Starting soon — not yet started')).toBeInTheDocument();
    expect(screen.getByText('in 15 min')).toBeInTheDocument();
    expect(screen.getByText('3:30 PM EST')).toBeInTheDocument();

    // Marketing: static treatment, no pulse/ping anywhere.
    expect(document.querySelector('.animate-pulse')).toBeNull();
    expect(document.querySelector('.animate-ping')).toBeNull();
  });

  it('blinks for technical roles (pulse chip + ping dot)', async () => {
    mockRole = 'user';
    mockTasks([TASK()]);
    render(<UpcomingInterviews />);

    await screen.findByText(/Janavi Soni/);
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
    expect(document.querySelector('.animate-ping')).not.toBeNull();
  });

  it('marks overdue tasks and opens the task sheet on click', async () => {
    mockTasks([TASK({ interviewStartAt: new Date(Date.now() - 5 * 60 * 1000).toISOString() })]);
    render(<UpcomingInterviews />);

    expect(await screen.findByText('5 min overdue')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /View task — Janavi Soni/ }));
    expect(screen.getByTestId('task-sheet')).toHaveTextContent('t-1');
  });
});

describe('relativeLabel', () => {
  const now = Date.UTC(2026, 5, 12, 12, 0, 0);

  it('labels future, immediate, and overdue starts', () => {
    expect(relativeLabel(new Date(now + 14 * 60 * 1000).toISOString(), now)).toEqual({
      text: 'in 14 min',
      overdue: false,
    });
    expect(relativeLabel(new Date(now).toISOString(), now)).toEqual({ text: 'now', overdue: true });
    expect(relativeLabel(new Date(now - 7 * 60 * 1000).toISOString(), now)).toEqual({
      text: '7 min overdue',
      overdue: true,
    });
    expect(relativeLabel(null, now)).toEqual({ text: '', overdue: false });
  });
});
