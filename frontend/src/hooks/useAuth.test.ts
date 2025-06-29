import { describe, expect, it, vi } from 'vitest';
import { requestRefreshToken } from './useAuth';
import { io } from 'socket.io-client';

vi.mock('socket.io-client', () => ({
  io: vi.fn()
}));

describe('requestRefreshToken', () => {
  it('returns new token on success', async () => {
    const mockEmit = vi.fn((event, data, cb) => cb({ success: true, accessToken: 'new' }));
    (io as unknown as vi.Mock).mockReturnValue({
      connect: vi.fn(),
      emit: mockEmit,
      disconnect: vi.fn(),
    });
    const token = await requestRefreshToken('r');
    expect(token).toBe('new');
  });

  it('returns null on failure', async () => {
    const mockEmit = vi.fn((event, data, cb) => cb({ success: false }));
    (io as unknown as vi.Mock).mockReturnValue({
      connect: vi.fn(),
      emit: mockEmit,
      disconnect: vi.fn(),
    });
    const token = await requestRefreshToken('r');
    expect(token).toBeNull();
  });
});
