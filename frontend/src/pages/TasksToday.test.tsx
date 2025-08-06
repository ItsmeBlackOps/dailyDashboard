import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect } from 'vitest';
import TasksToday from './TasksToday';
import { TabProvider } from '@/hooks/useTabs';
import { io } from 'socket.io-client';

vi.mock('socket.io-client', () => ({
  io: vi.fn(),
}));

function setupSocket() {
  const handlers: Record<string, Function> = {};
  const socket = {
    emit: vi.fn(),
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
  it('fetches tasks again when tab changes', async () => {
    const socket = setupSocket();
    render(
      <BrowserRouter>
        <TabProvider>
          <TasksToday />
        </TabProvider>
      </BrowserRouter>
    );

    await waitFor(() => expect(socket.emit).toHaveBeenCalled());
    socket.emit.mockClear();

    fireEvent.click(screen.getByText('Second'));
    await waitFor(() => expect(socket.emit).toHaveBeenCalled());
  });
});
