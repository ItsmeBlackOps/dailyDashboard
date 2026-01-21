import { MongoClient } from "mongodb";
import { config } from './index.js';
import { logger } from '../utils/logger.js';

class Database {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
    this.commandLoggerAttached = false;
  }

  async connect() {
    try {
      logger.info('🚀 Connecting to MongoDB...');

      const clientOptions = {
        ...(config.database.options || {}),
        monitorCommands: true
      };

      // Connect Native Driver (for Tasks, etc.)
      this.client = new MongoClient(config.database.uri, clientOptions);
      await this.client.connect();

      this.db = this.client.db(config.database.dbName);

      // Connect Mongoose (for CandidateComment, etc.)
      // Mongoose 6+ defaults are usually fine
      this.isConnected = true;
      this.attachCommandLogger();

      logger.info('✅ Connected to MongoDB', {
        database: config.database.dbName
      });

      return this.db;
    } catch (error) {
      logger.error('❌ MongoDB connection failed', { error: error.message });
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      logger.info('📴 Disconnected from MongoDB');
    }
  }

  getDatabase() {
    if (!this.isConnected || !this.db) {
      throw new Error('Database not connected');
    }
    return this.db;
  }

  getCollection(name) {
    return this.getDatabase().collection(name);
  }

  async healthCheck() {
    try {
      await this.db.admin().ping();
      return { status: 'healthy', timestamp: new Date().toISOString() };
    } catch (error) {
      return { status: 'unhealthy', error: error.message, timestamp: new Date().toISOString() };
    }
  }

  attachCommandLogger() {
    if (this.commandLoggerAttached || !this.client) {
      return;
    }

    const interestingCommands = new Set([
      'find',
      'aggregate',
      'insert',
      'insertOne',
      'insertMany',
      'update',
      'updateOne',
      'updateMany',
      'delete',
      'deleteOne',
      'deleteMany',
      'findAndModify',
      'findandmodify',
      'count',
      'countDocuments',
      'estimatedDocumentCount'
    ]);

    const jsonReplacer = (_key, value) => {
      if (value instanceof Date) {
        return value.toISOString();
      }
      if (value && typeof value === 'object') {
        if (typeof value.toHexString === 'function') {
          return value.toHexString();
        }
        if (value instanceof RegExp) {
          return value.toString();
        }
      }
      return value;
    };

    this.client.on('commandStarted', (event) => {
      if (!interestingCommands.has(event.commandName)) {
        return;
      }

      try {
        const payload = {
          database: event.databaseName,
          command: event.command,
          requestId: event.requestId,
          connectionId: event.connectionId
        };
        console.log(`[mongo:${event.commandName}] ${JSON.stringify(payload, jsonReplacer)}`);
      } catch (error) {
        console.log(`[mongo:${event.commandName}] unable to stringify command payload: ${error.message}`);
      }
    });

    this.commandLoggerAttached = true;
  }
}

export const database = new Database();
