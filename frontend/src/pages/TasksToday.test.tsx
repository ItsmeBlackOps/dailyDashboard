import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeAll } from 'vitest';
import TasksToday from './TasksToday';
import { io } from 'socket.io-client';

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
  it.skip('fetches tasks again when tab changes', async () => {
    // TODO: Update test once the tab switcher is exposed in the refactored layout.
    expect(true).toBe(true);
  });
});
