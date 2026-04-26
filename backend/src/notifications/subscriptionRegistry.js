import crypto from 'node:crypto';
import { deriveTagsFromScope } from './tags.js';
import { logger } from '../utils/logger.js';

const DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET = 32;

export class SubscriptionRegistry {
  constructor({ maxSubscriptionsPerSocket = DEFAULT_MAX_SUBSCRIPTIONS_PER_SOCKET } = {}) {
    this.maxSubscriptionsPerSocket = maxSubscriptionsPerSocket;
    this.subscriptionById = new Map();
    this.subscriptionsBySocket = new Map();
    this.tagIndex = new Map();
  }

  register(socket, scope) {
    if (!socket?.id) {
      throw new Error('Socket reference is required');
    }

    const normalizedScope = this.normalizeScope(scope);
    const tags = deriveTagsFromScope(normalizedScope);

    if (tags.size === 0) {
      throw new Error('Scope did not produce any tags');
    }

    const socketSubscriptions = this.subscriptionsBySocket.get(socket.id) || new Set();
    if (socketSubscriptions.size >= this.maxSubscriptionsPerSocket) {
      throw new Error('Subscription limit reached for socket');
    }

    const subscriptionId = crypto.randomUUID();
    const record = {
      id: subscriptionId,
      socketId: socket.id,
      scope: normalizedScope,
      tags,
      createdAt: new Date()
    };

    this.subscriptionById.set(subscriptionId, record);
    socketSubscriptions.add(subscriptionId);
    this.subscriptionsBySocket.set(socket.id, socketSubscriptions);

    for (const tag of tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag).add(subscriptionId);
    }

    logger.debug('Notification subscription registered', {
      socketId: socket.id,
      subscriptionId,
      tags: Array.from(tags)
    });

    return record;
  }

  unregister(socketId, subscriptionId) {
    const record = this.subscriptionById.get(subscriptionId);
    if (!record || record.socketId !== socketId) {
      return false;
    }

    this.subscriptionById.delete(subscriptionId);

    const socketSubscriptions = this.subscriptionsBySocket.get(socketId);
    if (socketSubscriptions) {
      socketSubscriptions.delete(subscriptionId);
      if (socketSubscriptions.size === 0) {
        this.subscriptionsBySocket.delete(socketId);
      }
    }

    for (const tag of record.tags) {
      const tagSet = this.tagIndex.get(tag);
      if (!tagSet) continue;
      tagSet.delete(subscriptionId);
      if (tagSet.size === 0) {
        this.tagIndex.delete(tag);
      }
    }

    logger.debug('Notification subscription removed', {
      socketId,
      subscriptionId
    });

    return true;
  }

  unregisterAllForSocket(socketId) {
    const socketSubscriptions = this.subscriptionsBySocket.get(socketId);
    if (!socketSubscriptions) {
      return;
    }

    const ids = Array.from(socketSubscriptions);
    for (const subscriptionId of ids) {
      this.unregister(socketId, subscriptionId);
    }
  }

  resolveSubscriptionsByTag(tag) {
    const ids = this.tagIndex.get(tag);
    if (!ids) {
      return [];
    }
    return Array.from(ids)
      .map((id) => this.subscriptionById.get(id))
      .filter(Boolean);
  }

  resolveSocketIdsByTags(tags) {
    const recipients = new Set();
    for (const tag of tags) {
      const records = this.resolveSubscriptionsByTag(tag);
      for (const record of records) {
        recipients.add(record.socketId);
      }
    }
    return recipients;
  }

  normalizeScope(scope) {
    if (!scope || typeof scope !== 'object') {
      throw new TypeError('scope must be an object');
    }

    const type = typeof scope.type === 'string' ? scope.type.trim().toLowerCase() : '';

    if (!type) {
      throw new Error('scope.type is required');
    }

    if (type === 'branch') {
      return {
        type,
        value: typeof scope.value === 'string' ? scope.value.trim() : ''
      };
    }

    if (type === 'hierarchy' || type === 'expert') {
      const values = Array.isArray(scope.value) ? scope.value : [];
      return {
        type,
        value: values
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean)
      };
    }

    if (type === 'candidate') {
      return {
        type,
        value: scope.value
      };
    }

    throw new Error(`Unsupported scope type: ${type}`);
  }
}
