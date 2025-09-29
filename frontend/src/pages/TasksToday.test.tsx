import { render, fireEvent, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeAll } from 'vitest';
import TasksToday from './TasksToday';
import { io } from 'socket.io-client';
import { TooltipProvider } from '@/components/ui/tooltip';

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
      if (event === 'getTasksToday' && typeof cb === 'function') {
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

    // Suggestions column should be visible
    expect(Boolean(screen.getByText('Suggestions'))).toBe(true);

    // The suggestion value from candidateExpertDisplay should render
    expect(Boolean(await screen.findByText(/Ayush K/))).toBe(true);

    // Toggle on Subject
    const toggle = screen.getByLabelText('Show Subject');
    fireEvent.click(toggle);

    // Now Subject column should appear
    expect(Boolean(await screen.findByText('Subject'))).toBe(true);
  });
  it.skip('fetches tasks again when tab changes', async () => {
    // TODO: Update test once the tab switcher is exposed in the refactored layout.
    expect(true).toBe(true);
  });
});
