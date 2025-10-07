import { logger } from '../utils/logger.js';

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
    const recipients = this.subscriptionRegistry.resolveSocketIdsByTags([audienceScope]);

    if (recipients.size === 0) {
      await this.outboxRepository.markSkipped(_id, 'no_recipients');
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
}
