import crypto from 'node:crypto';
import { domainEventBus } from '../events/eventBus.js';
import { DomainEvents } from '../events/eventTypes.js';
import { deriveTagsFromCandidate } from './tags.js';
import { logger } from '../utils/logger.js';

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24; // 24h

const priorityForEvent = (eventType) => {
  switch (eventType) {
    case DomainEvents.CandidateExpertAssigned:
      return 90;
    case DomainEvents.CandidateResumeStatusChanged:
      return 80;
    case DomainEvents.CandidateCreated:
      return 70;
    case DomainEvents.CandidateUpdated:
      return 60;
    case DomainEvents.CandidateSupportRequested:
      return 50;
    default:
      return 40;
  }
};

export class NotificationOrchestrator {
  constructor(outboxRepository) {
    this.outboxRepository = outboxRepository;
    this.teardownCallbacks = [];
  }

  initialize() {
    this.teardownCallbacks.push(
      domainEventBus.subscribe(DomainEvents.CandidateCreated, (event) => {
        this.handleCandidateEvent(DomainEvents.CandidateCreated, event);
      })
    );

    this.teardownCallbacks.push(
      domainEventBus.subscribe(DomainEvents.CandidateUpdated, (event) => {
        this.handleCandidateEvent(DomainEvents.CandidateUpdated, event);
      })
    );

    this.teardownCallbacks.push(
      domainEventBus.subscribe(DomainEvents.CandidateExpertAssigned, (event) => {
        this.handleCandidateEvent(DomainEvents.CandidateExpertAssigned, event);
      })
    );

    this.teardownCallbacks.push(
      domainEventBus.subscribe(DomainEvents.CandidateResumeStatusChanged, (event) => {
        this.handleCandidateEvent(DomainEvents.CandidateResumeStatusChanged, event);
      })
    );
  }

  shutdown() {
    while (this.teardownCallbacks.length > 0) {
      const teardown = this.teardownCallbacks.pop();
      try {
        teardown?.();
      } catch (error) {
        logger.warn('Notification orchestrator teardown failed', {
          error: error.message
        });
      }
    }
  }

  async handleCandidateEvent(eventType, event) {
    if (!event?.candidate) {
      logger.warn('Candidate event missing candidate payload', { eventType });
      return;
    }

    const tags = deriveTagsFromCandidate(event.candidate);
    if (tags.size === 0) {
      logger.debug('Candidate event produced no audience tags', {
        eventType,
        candidateId: event.candidate.id || event.candidate._id
      });
      return;
    }

    const notifications = [];
    const payload = this.buildPayload(eventType, event);
    const eventId = event.eventId || crypto.randomUUID();

    for (const tag of tags) {
      notifications.push(this.buildNotificationRecord({
        eventType,
        eventId,
        audienceScope: tag,
        payload
      }));
    }

    for (const notification of notifications) {
      await this.outboxRepository.enqueue(notification);
    }
  }

  buildNotificationRecord({ eventType, eventId, audienceScope, payload }) {
    const now = Date.now();
    const checksum = crypto.createHash('sha256')
      .update([eventType, eventId, audienceScope, payload.version].join('|'))
      .digest('hex');

    return {
      eventType,
      eventId,
      audienceScope,
      payload,
      priority: priorityForEvent(eventType),
      checksum,
      channel: 'socket',
      availableAt: new Date(),
      expiresAt: new Date(now + (payload.ttlMs || DEFAULT_TTL_MS))
    };
  }

  buildPayload(eventType, event) {
    const basePayload = {
      version: '1.0.0',
      type: eventType,
      candidateId: event.candidate.id || event.candidate._id,
      candidateName: event.candidate.name || event.candidate['Candidate Name'] || '',
      branch: event.candidate.branch || event.candidate.Branch || '',
      recruiter: event.candidate.recruiterRaw || event.candidate.recruiter || event.candidate.Recruiter || '',
      expert: event.candidate.expertRaw || event.candidate.expert || event.candidate.Expert || '',
      triggeredBy: event.actor?.email || null,
      triggeredByRole: event.actor?.role || null,
      changeDetails: event.changeDetails || null,
      actor: event.actor || null,
      occurredAt: event.occurredAt || new Date().toISOString(),
      ttlMs: DEFAULT_TTL_MS
    };

    switch (eventType) {
      case DomainEvents.CandidateCreated:
        return {
          ...basePayload,
          message: `${basePayload.candidateName} was added to ${basePayload.branch}.`,
          category: 'candidate:new'
        };
      case DomainEvents.CandidateUpdated:
        return {
          ...basePayload,
          message: `${basePayload.candidateName} was updated.`,
          changes: Array.isArray(event.changes) ? event.changes : [],
          category: 'candidate:update'
        };
      case DomainEvents.CandidateExpertAssigned:
        return {
          ...basePayload,
          message: `${basePayload.candidateName} was assigned to ${basePayload.expert}.`,
          category: 'candidate:expert'
        };
      case DomainEvents.CandidateResumeStatusChanged:
        return {
          ...basePayload,
          message: `${basePayload.candidateName} resume status changed to ${event.status || 'updated'}.`,
          status: event.status || null,
          category: 'candidate:resume'
        };
      case DomainEvents.CandidateSupportRequested:
        return {
          ...basePayload,
          message: `${basePayload.candidateName} has a new support request.`,
          category: 'candidate:support'
        };
      default:
        return basePayload;
    }
  }
}
