import { NotificationOutboxRepository } from './notificationOutboxRepository.js';
import { SubscriptionRegistry } from './subscriptionRegistry.js';
import { NotificationOrchestrator } from './notificationOrchestrator.js';
import { NotificationDeliveryWorker } from './notificationDeliveryWorker.js';
import { logger } from '../utils/logger.js';

export class NotificationCenter {
  constructor() {
    this.outboxRepository = new NotificationOutboxRepository();
    this.subscriptionRegistry = new SubscriptionRegistry();
    this.orchestrator = new NotificationOrchestrator(this.outboxRepository);
    this.worker = null;
    this.io = null;
  }

  async initialize(io) {
    this.io = io;
    await this.outboxRepository.initialize();
    this.orchestrator.initialize();
    this.worker = new NotificationDeliveryWorker({
      outboxRepository: this.outboxRepository,
      subscriptionRegistry: this.subscriptionRegistry,
      io: this.io
    });
    this.worker.start();
    logger.info('Notification center initialized');
  }

  registerSocket(socket) {
    socket.on('candidateNotifications:subscribe', (payload = {}, callback) => {
      try {
        const scope = payload?.scope;
        if (!scope) {
          throw new Error('scope is required');
        }

        const record = this.subscriptionRegistry.register(socket, scope);
        socket.join(`candidate:${record.id}`);
        if (typeof callback === 'function') {
          callback({
            success: true,
            subscriptionId: record.id,
            tags: Array.from(record.tags)
          });
        }
      } catch (error) {
        logger.warn('Failed to register notification subscription', {
          error: error.message,
          socketId: socket.id
        });
        if (typeof callback === 'function') {
          callback({
            success: false,
            error: error.message
          });
        }
      }
    });

    socket.on('candidateNotifications:unsubscribe', (payload = {}, callback) => {
      const subscriptionId = payload.subscriptionId;
      if (!subscriptionId) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'subscriptionId required' });
        }
        return;
      }

      const removed = this.subscriptionRegistry.unregister(socket.id, subscriptionId);
      socket.leave(`candidate:${subscriptionId}`);

      if (typeof callback === 'function') {
        callback({ success: removed });
      }
    });

    socket.on('disconnect', () => {
      this.subscriptionRegistry.unregisterAllForSocket(socket.id);
    });
  }

  shutdown() {
    this.worker?.stop();
    this.orchestrator.shutdown();
    logger.info('Notification center shutdown completed');
  }
}

export const notificationCenter = new NotificationCenter();
