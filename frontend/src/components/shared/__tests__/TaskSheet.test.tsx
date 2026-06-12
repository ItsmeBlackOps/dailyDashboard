/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TaskSheet } from '../TaskSheet';

const authFetchMock = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  API_URL: 'http://localhost:3004',
  useAuth: () => ({ authFetch: authFetchMock }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('@/lib/roleAliases', () => ({
  canSeeBotStatus: () => false,
}));

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const BASE_TASK = {
  _id: 't1',
  taskId: 't1',
  candidateId: null,
  candidateName: 'Janavi Soni',
  emailId: 'janavi@x.com',
  date: '2026-06-11',
  startTime: '03:30 PM',
  endTime: '04:30 PM',
  role: 'Tax Preparer',
  client: 'Acme',
  round: '2nd',
  actualRound: '',
  status: 'pending',
  vendor: '',
  recruiter: 'rec@x.com',
  assignedTo: '',
  assignedAt: null,
  suggestions: [],
  receivedAt: null,
  body: 'Original email body',
  replies: [],
  subject: 'Interview Support - Janavi Soni',
  meetingLink: 'https://teams.microsoft.com/l/meetup-join/x',
  meetingPassword: null,
  botStatus: null,
  botInviteAttempts: null,
  botJoinedAt: null,
  botLastError: null,
};

function mockTask(task: Record<string, unknown>) {
  authFetchMock.mockResolvedValue({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ success: true, task }),
  });
}

describe('TaskSheet — people on this task', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders owner, co-experts, and pending co-assigns with their states', async () => {
    mockTask({
      ...BASE_TASK,
      assignedTo: 'subhash.sharma@vizvainc.com',
      coAssignees: ['utsa.maiti@vizvainc.com'],
      pendingCoAssigns: [{
        email: 'aditya.sharma@vizvainc.com',
        requestedBy: 'anusree.vasudevan@vizvainc.com',
        requestedAt: '2026-06-12T12:00:00Z',
        approverEmail: 'prateek.narvariya@silverspaceinc.com',
      }],
    });

    render(<TaskSheet taskId="t1" onClose={() => {}} />);

    expect(await screen.findByText('People on this task')).toBeInTheDocument();
    // owner name also appears in the details grid's Expert field
    expect(screen.getAllByText('Subhash Sharma').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.getByText('Utsa Maiti')).toBeInTheDocument();
    expect(screen.getByText('co-expert')).toBeInTheDocument();
    expect(screen.getByText('Aditya Sharma')).toBeInTheDocument();
    expect(screen.getByText(/pending Prateek Narvariya/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add co-expert/i })).toBeInTheDocument();
  });
});

describe('TaskSheet — meeting start strip', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the start time, actor, and extension source above the Email Thread heading', async () => {
    mockTask({
      ...BASE_TASK,
      meetingStarted: true,
      meetingStartedAt: '2026-06-11T19:16:15.510Z',
      meetingStartedBy: 'darshan.singh@vizvainc.com',
      meetingStartedSource: 'extension',
    });

    render(<TaskSheet taskId="t1" onClose={() => {}} />);

    const started = await screen.findByText(/Meeting started ·/);
    expect(started).toBeInTheDocument();
    expect(screen.getByText(/by Darshan Singh/)).toBeInTheDocument();
    expect(screen.getByText(/auto-detected \(extension\)/)).toBeInTheDocument();

    // Placement: the strip renders BEFORE the Email Thread heading.
    const thread = screen.getByText('Email Thread');
    expect(
      started.compareDocumentPosition(thread) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('shows a neutral "not started yet" state when the flag is unset', async () => {
    mockTask({ ...BASE_TASK, meetingStarted: false });

    render(<TaskSheet taskId="t1" onClose={() => {}} />);

    expect(await screen.findByText('Meeting not started yet')).toBeInTheDocument();
    expect(screen.queryByText(/Meeting started ·/)).not.toBeInTheDocument();
  });
});
