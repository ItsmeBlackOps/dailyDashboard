import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { NotificationOrchestrator } from '../../src/notifications/notificationOrchestrator.js';
import { domainEventBus } from '../../src/events/eventBus.js';
import { DomainEvents } from '../../src/events/eventTypes.js';

describe('NotificationOrchestrator', () => {
  let orchestrator;
  let outbox;

  beforeEach(() => {
    outbox = {
      enqueue: jest.fn().mockResolvedValue(undefined)
    };
    orchestrator = new NotificationOrchestrator(outbox);
    orchestrator.initialize();
  });

  afterEach(() => {
    orchestrator.shutdown();
    jest.clearAllMocks();
  });

  test('enqueues notifications for candidate updates across tags', async () => {
    const eventPayload = {
      eventId: 'evt-1',
      candidate: {
        id: 'cand-1',
        name: 'Jane Doe',
        branch: 'ggr',
        recruiterRaw: 'recruiter@example.com',
        expertRaw: 'expert@example.com'
      },
      actor: {
        email: 'manager@example.com',
        role: 'manager'
      },
      changes: ['expert'],
      occurredAt: new Date().toISOString()
    };

    domainEventBus.publish(DomainEvents.CandidateUpdated, eventPayload);

    expect(outbox.enqueue).toHaveBeenCalled();
    const scopes = new Set(outbox.enqueue.mock.calls.map(([doc]) => doc.audienceScope));
    expect(scopes).toEqual(new Set([
      'branch:GGR',
      'recruiter:recruiter@example.com',
      'expert:expert@example.com',
      'candidate:cand-1'
    ]));
  });

  test('skips events without candidate payload', () => {
    domainEventBus.publish(DomainEvents.CandidateUpdated, null);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
