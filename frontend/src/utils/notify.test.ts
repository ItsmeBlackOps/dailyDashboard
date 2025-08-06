import { describe, it, expect, vi } from 'vitest';
import { sendNotification } from './notify';

describe('sendNotification', () => {
  it('uses existing permission', async () => {
    const create = vi.fn();
    const Fake: any = function(title: string, opts?: any) { create(title, opts); };
    Fake.permission = 'granted';
    (global as any).Notification = Fake;
    await sendNotification('t', 'b');
    expect(create).toHaveBeenCalledWith('t', { body: 'b' });
  });

  it('requests permission when default', async () => {
    const create = vi.fn();
    const request = vi.fn().mockResolvedValue('granted');
    const Fake: any = function(title: string, opts?: any) { create(title, opts); };
    Fake.permission = 'default';
    Fake.requestPermission = request;
    (global as any).Notification = Fake;
    await sendNotification('t', 'b');
    expect(request).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith('t', { body: 'b' });
  });
});
