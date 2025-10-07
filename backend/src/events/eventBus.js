import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger.js';

const DEFAULT_MAX_LISTENERS = 50;

export class DomainEventBus {
  constructor() {
    this.emitter = new EventEmitter({ captureRejections: true });
    this.emitter.setMaxListeners(DEFAULT_MAX_LISTENERS);
  }

  publish(eventName, payload) {
    if (!eventName || typeof eventName !== 'string') {
      throw new TypeError('eventName must be a non-empty string');
    }

    try {
      this.emitter.emit(eventName, payload);
    } catch (error) {
      logger.error('Domain event publish failed', {
        eventName,
        error: error.message
      });
      throw error;
    }
  }

  subscribe(eventName, handler) {
    if (!eventName || typeof eventName !== 'string') {
      throw new TypeError('eventName must be a non-empty string');
    }

    if (typeof handler !== 'function') {
      throw new TypeError('handler must be a function');
    }

    this.emitter.on(eventName, handler);

    return () => {
      this.emitter.off(eventName, handler);
    };
  }
}

export const domainEventBus = new DomainEventBus();
