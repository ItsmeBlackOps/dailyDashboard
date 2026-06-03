import React from 'react';
import { render, fireEvent, screen, cleanup, waitFor, act } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest';
import TasksToday from './TasksToday';
import { io } from 'socket.io-client';
import { TooltipProvider } from '@/components/ui/tooltip';

const loginPopupMock = vi.fn().mockResolvedValue({});
const getActiveAccountMock = vi.fn();
const setActiveAccountMock = vi.fn();

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: {
      loginPopup: loginPopupMock,
      getActiveAccount: getActiveAccountMock,
      setActiveAccount: setActiveAccountMock,
    },
    accounts: [],
  }),
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}));

vi.mock('@/contexts/MicrosoftConsentContext', () => ({
  useMicrosoftConsent: () => ({
    needsConsent: false,
    checking: false,
    error: '',
    hasAccount: false,
    grant: vi.fn().mockResolvedValue(false),
    refresh: vi.fn().mockResolvedValue(undefined),
    openConsentDialog: vi.fn(),
    closeConsentDialog: vi.fn(),
    isDialogOpen: false,
  }),
  MicrosoftConsentProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/context/NotificationContext', () => ({
  useNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    clearAll: vi.fn(),
    selectedNotification: null,
    isModalOpen: false,
    openModal: vi.fn(),
    closeModal: vi.fn(),
    pendingCallAlerts: [],
    respondToCallAlert: vi.fn(),
  }),
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
  const handlers: Record<string, Function[]> = {};
  const trigger = (event: string, ...args: any[]) => {
    for (const cb of handlers[event] || []) {
      cb(...args);
    }
  };

  const socket = {
    connected: false,
    recovered: false,
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
              assignedEmail: 'tester@example.com',
              transcription: false,
              candidateExpertDisplay: 'Ayush K'
            }
          ]
        });
      }
    }),
    on: vi.fn((event, cb) => {
      if (!handlers[event]) {
        handlers[event] = [];
      }
      handlers[event].push(cb);
    }),
    once: vi.fn((event, cb) => {
      const onceWrapper = (...args: any[]) => {
        cb(...args);
        socket.off(event, onceWrapper);
      };
      socket.on(event, onceWrapper);
    }),
    off: vi.fn(),
    connect: vi.fn(() => {
      socket.connected = true;
      trigger('connect');
    }),
    disconnect: vi.fn(() => {
      socket.connected = false;
      trigger('disconnect', 'io client disconnect');
    }),
    auth: {},
    __trigger: trigger
  } as any;

  socket.off.mockImplementation((event: string, cb?: Function) => {
    if (!handlers[event]) return;
    if (!cb) {
      delete handlers[event];
      return;
    }
    handlers[event] = handlers[event].filter((handler) => handler !== cb);
  });

  (io as unknown as vi.Mock).mockReturnValue(socket);
  return socket;
}

describe('TasksToday', () => {
  beforeAll(() => {
    localStorage.setItem('accessToken', 'test');
    localStorage.setItem('role', 'user');
    localStorage.setItem('email', 'tester@example.com');
  });

  beforeEach(() => {
    loginPopupMock.mockClear();
    getActiveAccountMock.mockClear();
    setActiveAccountMock.mockClear();

    // Mock fetch for /api/users/active and any other REST calls the component makes
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (typeof url === 'string' && url.includes('/api/users/active')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, byRole: {} }),
        } as Response);
      }
      if (typeof url === 'string' && url.includes('/api/tasks')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }
      // Default: return empty ok response
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    }));

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible'
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.setItem('role', 'user');
    vi.useRealTimers();
    vi.unstubAllGlobals();
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

    // Meeting actions default to create button when no link stored
    expect(
      screen.queryByRole('button', { name: /Create meeting/i }) ||
      screen.queryByRole('button', { name: /Creating/i })
    ).toBeTruthy();

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

  it('refetches on unrecovered reconnect', async () => {
    const socket = setupSocket();

    render(
      <BrowserRouter>
        <TooltipProvider>
          <TasksToday />
        </TooltipProvider>
      </BrowserRouter>
    );

    await screen.findByText(/Test Candidate/);

    const fetchCalls = () => socket.emit.mock.calls.filter((call) => call[0] === 'getTasksByRange').length;
    const beforeReconnect = fetchCalls();

    socket.recovered = false;
    socket.__trigger('connect');

    await waitFor(() => {
      expect(fetchCalls()).toBeGreaterThan(beforeReconnect);
    });
  });

  it('removes task row when taskRemoved is received', async () => {
    const socket = setupSocket();

    render(
      <BrowserRouter>
        <TooltipProvider>
          <TasksToday />
        </TooltipProvider>
      </BrowserRouter>
    );

    await screen.findByText(/Test Candidate/);
    socket.__trigger('taskRemoved', { _id: 't1' });

    await waitFor(() => {
      expect(screen.queryByText(/Test Candidate/)).toBeNull();
    });
  });

  it('runs fallback polling every minute for disconnected sockets', async () => {
    const socket = setupSocket();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    render(
      <BrowserRouter>
        <TooltipProvider>
          <TasksToday />
        </TooltipProvider>
      </BrowserRouter>
    );

    await screen.findByText(/Test Candidate/);

    const connectCallsBefore = socket.connect.mock.calls.length;
    socket.connected = false;
    const pollRegistration = setIntervalSpy.mock.calls.find((call) => call[1] === 60_000);
    expect(pollRegistration).toBeDefined();

    const pollCallback = pollRegistration?.[0] as (() => void) | undefined;
    expect(typeof pollCallback).toBe('function');

    act(() => {
      pollCallback?.();
    });

    expect(socket.connect.mock.calls.length).toBeGreaterThan(connectCallsBefore);
    setIntervalSpy.mockRestore();
  });

  it('auto-attempts meeting creation when visible tasks have no join link', async () => {
    setupSocket();

    render(
      <BrowserRouter>
        <TooltipProvider>
          <TasksToday />
        </TooltipProvider>
      </BrowserRouter>
    );

    await screen.findByText(/Test Candidate/);

    await waitFor(() => {
      expect(loginPopupMock).toHaveBeenCalled();
    });
  });

  it('does not auto-attempt meeting creation when task is assigned to another user', async () => {
    const socket = setupSocket();
    socket.emit.mockImplementation((event: string, payload: any, cb?: Function) => {
      if (event === 'getTasksByRange' && typeof cb === 'function') {
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
              assignedEmail: 'otheruser@example.com',
              transcription: false
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

    await screen.findByText(/Test Candidate/);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(loginPopupMock).not.toHaveBeenCalled();
  });
});
