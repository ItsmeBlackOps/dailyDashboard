import { logger } from '../utils/logger.js';
import { notificationModel } from '../models/Notification.js';
import { candidateService } from '../services/candidateService.js';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_ATTEMPTS = 5;

export class NotificationDeliveryWorker {
  constructor({
    outboxRepository,
    subscriptionRegistry,
    io,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    batchSize = DEFAULT_BATCH_SIZE,
    maxAttempts = DEFAULT_MAX_ATTEMPTS
  }) {
    this.outboxRepository = outboxRepository;
    this.subscriptionRegistry = subscriptionRegistry;
    this.io = io;
    this.pollIntervalMs = pollIntervalMs;
    this.batchSize = batchSize;
    this.maxAttempts = maxAttempts;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.scheduleNextTick(0);
    logger.info('Notification delivery worker started');
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('Notification delivery worker stopped');
  }

  scheduleNextTick(delay = this.pollIntervalMs) {
    if (!this.running) {
      return;
    }
    this.timer = setTimeout(() => {
      this.tick().catch((error) => {
        logger.error('Notification delivery tick failed', { error: error.message });
      }).finally(() => {
        this.scheduleNextTick();
      });
    }, delay);
  }

  async tick() {
    const batch = await this.outboxRepository.claimPendingBatch(this.batchSize);
    if (!batch.length) {
      return;
    }

    for (const notification of batch) {
      await this.deliver(notification);
    }
  }

  async deliver(notification) {
    const { _id, audienceScope, payload } = notification;

    // Extract ALL recipient emails that should receive this notification
    // For email tags (recruiter:, expert:), extract the email directly
    // For broadcast tags (branch:, candidate:), use payload to find recipients
    const recipientEmails = this.resolveRecipientsFromNotification(audienceScope, payload);

    // STEP 1: Persist notification to database for all recipients
    for (const recipientEmail of recipientEmails) {
      try {
        await notificationModel.createNotification({
          recipient: recipientEmail,
          type: payload.type || 'info',
          title: this.buildTitle(payload),
          description: payload.message || payload.description || '',
          link: payload.link || null,
          candidateId: payload.candidateId || null,
          batchData: payload.batchData || null,
          changeDetails: payload.changeDetails || null,
          actor: payload.actor || null,
          eventId: _id // referencing the notificationId from the loop
        });
        logger.debug('Notification persisted to database', {
          recipient: recipientEmail,
          audienceScope,
          notificationId: _id.toString()
        });
      } catch (error) {
        logger.error('Failed to persist notification to database', {
          recipient: recipientEmail,
          audienceScope,
          notificationId: _id.toString(),
          error: error.message
        });
        // Continue to next recipient even if one fails
      }
    }

    // STEP 2: Send real-time socket notification
    const recipients = this.subscriptionRegistry.resolveSocketIdsByTags([audienceScope]);

    if (recipients.size === 0) {
      // No active sockets, but notifications were persisted above
      await this.outboxRepository.markSkipped(_id, 'no_active_sockets');
      return;
    }

    const namespace = this.io.of('/');
    const sockets = namespace.sockets;

    const deliveredTo = [];
    for (const socketId of recipients) {
      const socket = sockets.get(socketId);
      if (!socket) {
        continue;
      }

      try {
        socket.emit('notifications:new', {
          ...payload,
          notificationId: _id.toString(),
          scope: audienceScope
        });
        deliveredTo.push(socketId);
      } catch (error) {
        logger.warn('Notification delivery failed for socket', {
          socketId,
          notificationId: _id.toString(),
          error: error.message
        });
      }
    }

    if (deliveredTo.length === 0) {
      await this.outboxRepository.markSkipped(_id, 'no_active_sockets');
      return;
    }

    await this.outboxRepository.markDelivered(_id, deliveredTo);
  }

  buildTitle(payload) {
    // Build title from payload type
    switch (payload.category) {
      case 'candidate:new':
        return 'New Candidate';
      case 'candidate:update':
        return 'Candidate Updated';
      case 'candidate:expert':
        return 'Expert Assigned';
      case 'candidate:resume':
        return 'Resume Status Changed';
      case 'candidate:support':
        return 'Support Requested';
      default:
        return payload.title || 'Notification';
    }
  }

  resolveRecipientsFromNotification(tag, payload) {
    if (!tag) return [];

    const recipients = new Set();

    // Tag format examples:
    // "recruiter:email@domain.com" → extract email directly
    // "expert:email@domain.com" → extract email directly
    // "branch:AHM" → resolve full hierarchy from payload
    // "candidate:id" → resolve full hierarchy from payload

    const parts = tag.split(':');
    if (parts.length !== 2) return [];

    const [tagType, value] = parts;

    // Direct email tags - extract the email
    if (tagType === 'recruiter' || tagType === 'expert') {
      if (value.includes('@')) {
        recipients.add(value.toLowerCase());
      }
    }
    // Broadcast tags - resolve full hierarchy
    else if (tagType === 'branch' || tagType === 'candidate') {
      // Build candidate object from payload for hierarchy resolution
      const candidate = {
        id: payload.candidateId,
        name: payload.candidateName,
        Branch: payload.branch,
        branch: payload.branch,
        Recruiter: payload.recruiter,
        recruiter: payload.recruiter,
        Expert: payload.expert,
        expert: payload.expert,
        expertRaw: payload.expert
      };

      // Resolve recruitment hierarchy: Recruiter → MLead → MAM → MM
      const hierarchyWatchers = candidateService.resolveHierarchyWatchers(candidate);
      hierarchyWatchers.forEach(email => {
        if (email && email.includes('@')) {
          recipients.add(email.toLowerCase());
        }
      });

      // Resolve expert hierarchy: Expert → Lead → AM
      const expertWatchers = candidateService.resolveExpertHierarchy(payload.expert);
      expertWatchers.forEach(email => {
        if (email && email.includes('@')) {
          recipients.add(email.toLowerCase());
        }
      });

      // Add admins (if available via candidateService)
      // Note: candidateService.resolveAllWatchers includes admins, but we're building it manually here
      // to avoid circular dependencies. If admins are needed, they can be added via userModel.getAllUsers()
    }

    return Array.from(recipients);
  }
}
