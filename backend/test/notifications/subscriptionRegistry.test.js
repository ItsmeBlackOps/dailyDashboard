import { describe, expect, test, beforeEach } from '@jest/globals';
import { SubscriptionRegistry } from '../../src/notifications/subscriptionRegistry.js';

describe('SubscriptionRegistry', () => {
  let registry;
  let socket;

  beforeEach(() => {
    registry = new SubscriptionRegistry();
    socket = { id: 'socket-1' };
  });

  test('registers branch scope and resolves recipients', () => {
    const subscription = registry.register(socket, { type: 'branch', value: 'ggr' });

    expect(subscription.tags.has('branch:GGR')).toBe(true);

    const recipients = registry.resolveSocketIdsByTags(['branch:GGR']);
    expect(recipients.has('socket-1')).toBe(true);
  });

  test('registers hierarchy scope as recruiter tags', () => {
    const subscription = registry.register(socket, {
      type: 'hierarchy',
      value: ['Recruiter@One.com', 'recruiter2@one.com']
    });

    expect(subscription.tags.has('recruiter:recruiter@one.com')).toBe(true);
    expect(subscription.tags.has('recruiter:recruiter2@one.com')).toBe(true);

    const recipients = registry.resolveSocketIdsByTags(['recruiter:recruiter2@one.com']);
    expect(recipients.has('socket-1')).toBe(true);
  });

  test('unregister removes socket subscriptions', () => {
    const subscription = registry.register(socket, { type: 'branch', value: 'ggr' });
    const removed = registry.unregister(socket.id, subscription.id);

    expect(removed).toBe(true);
    expect(registry.resolveSocketIdsByTags(['branch:GGR']).size).toBe(0);
  });

  test('unregisterAllForSocket clears all tags', () => {
    const first = registry.register(socket, { type: 'branch', value: 'ggr' });
    registry.register(socket, { type: 'hierarchy', value: ['alpha@example.com'] });

    registry.unregisterAllForSocket(socket.id);

    expect(registry.resolveSocketIdsByTags(['branch:GGR']).size).toBe(0);
    expect(registry.resolveSocketIdsByTags(['recruiter:alpha@example.com']).size).toBe(0);
    expect(registry.unregister(socket.id, first.id)).toBe(false);
  });
});
