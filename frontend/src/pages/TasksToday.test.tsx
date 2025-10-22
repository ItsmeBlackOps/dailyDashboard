import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeAll, afterEach } from 'vitest';
import TasksToday from './TasksToday';
import { io } from 'socket.io-client';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: {
      loginPopup: vi.fn().mockResolvedValue({}),
      getActiveAccount: vi.fn(),
      setActiveAccount: vi.fn(),
    },
    accounts: [],
  }),
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

function setupSocket() {
  const handlers: Record<string, Function> = {};
  const socket = {
    emit: vi.fn((event: string, payload: any, cb?: Function) => {
      if (event === 'getTasksByRange' && typeof cb === 'function') {
        // Provide a single task for today with a candidate expert suggestion
        const today = new Date();
        const mm = (today.getMonth() + 1).toString().padStart(2, '0');
        const dd = today.getDate().toString().padStart(2, '0');
        const yyyy = today.getFullYear();
        const dateStr = `${mm}/${dd}/${yyyy}`;
        cb({
          success: true,
          tasks: [
            {
              _id: 't1',
              subject: 'Interview Support - Example',
              'Candidate Name': 'Test Candidate',
              'Date of Interview': dateStr,
              'Start Time Of Interview': '10:00 AM',
              'End Time Of Interview': '11:00 AM',
              'End Client': 'ClientX',
              'Interview Round': 'Round 1',
              assignedExpert: 'Not Assigned',
              transcription: false,
              candidateExpertDisplay: 'Ayush K'
            }
          ]
        });
      }
    }),
    on: vi.fn((event, cb) => {
      handlers[event] = cb;
    }),
    once: vi.fn((event, cb) => {
      if (event === 'connect') cb();
    }),
    off: vi.fn(),
    connect: vi.fn(() => {
      handlers['connect'] && handlers['connect']();
    }),
    disconnect: vi.fn(),
    auth: {},
  } as any;
  (io as unknown as vi.Mock).mockReturnValue(socket);
  return socket;
}

describe('TasksToday', () => {
beforeAll(() => {
  localStorage.setItem('accessToken', 'test');
  localStorage.setItem('role', 'user');
  localStorage.setItem('email', 'tester@example.com');
});

afterEach(() => {
  cleanup();
  localStorage.setItem('role', 'user');
});

  it('hides Subject by default and can toggle it', async () => {
    setupSocket();

    render(
      <BrowserRouter>
        <TooltipProvider>
          <TasksToday />
        </TooltipProvider>
      </BrowserRouter>
    );

    // Subject column should be hidden by default
    expect(screen.queryByText('Subject')).toBeNull();

    await screen.findByText(/Test Candidate/);

    // The suggestion value from candidateExpertDisplay should render
    expect(Boolean(await screen.findByText(/Ayush K/))).toBe(true);

    // Meeting actions default to create button when no link stored
    const createButton = await screen.findByRole('button', { name: /Create meeting/i });
    expect(createButton).toBeDefined();

    // Toggle on Subject
    const toggle = screen.getByLabelText('Show Subject');
    fireEvent.click(toggle);

    // Now Subject column should appear
    expect(Boolean(await screen.findByText('Subject'))).toBe(true);
  });

  it('does not render meeting actions for disallowed roles', async () => {
    localStorage.setItem('role', 'expert');
    setupSocket();

    render(
      <BrowserRouter>
        <TooltipProvider>
          <TasksToday />
        </TooltipProvider>
      </BrowserRouter>
    );

    expect(screen.queryByRole('button', { name: /Create meeting/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Join/i })).toBeNull();
  });

  it('shows join and copy buttons when a join link exists', async () => {
    localStorage.setItem('role', 'admin');
    const socket = setupSocket();
    socket.emit.mockImplementation((event, payload, cb) => {
      if (event === 'getTasksByRange' && typeof cb === 'function') {
        const today = new Date();
        const mm = (today.getMonth() + 1).toString().padStart(2, '0');
        const dd = today.getDate().toString().padStart(2, '0');
        const yyyy = today.getFullYear();
        cb({
          success: true,
          tasks: [
            {
              _id: 't1',
              subject: 'Interview Support - Example',
              'Candidate Name': 'Test Candidate',
              'Date of Interview': `${mm}/${dd}/${yyyy}`,
              'Start Time Of Interview': '10:00 AM',
              'End Time Of Interview': '11:00 AM',
              assignedExpert: 'Not Assigned',
              transcription: false,
              joinUrl: 'https://teams.microsoft.com/l/meetup-join/example'
            }
          ]
        });
      }
    });

    render(
      <BrowserRouter>
        <TooltipProvider>
          <TasksToday />
        </TooltipProvider>
      </BrowserRouter>
    );

    expect(await screen.findByRole('button', { name: /^Join$/i })).toBeDefined();
    expect(await screen.findByRole('button', { name: /Copy link/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Create meeting/i })).toBeNull();
  });
  it.skip('fetches tasks again when tab changes', async () => {
    // TODO: Update test once the tab switcher is exposed in the refactored layout.
    expect(true).toBe(true);
  });
});
