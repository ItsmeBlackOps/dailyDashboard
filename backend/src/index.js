import "dotenv/config";

const backendNewRelicAppName =
  process.env.NEW_RELIC_BACKEND_APP_NAME ||
  process.env.NEW_RELIC_APP_NAME;

if (!process.env.NEW_RELIC_APP_NAME && backendNewRelicAppName) {
  process.env.NEW_RELIC_APP_NAME = backendNewRelicAppName;
}

// Initialize New Relic if license key is provided
if (process.env.NEW_RELIC_LICENSE_KEY && process.env.NEW_RELIC_APP_NAME) {
  try {
    await import("newrelic");
  } catch (error) {
    console.warn("⚠️ New Relic initialization failed:", error.message);
  }
}
import express from "express";
import http from "http";
import cors from "cors";
import morgan from "morgan";

// Import configuration and utilities
import { config, validateConfig } from './config/index.js';
import { database } from './config/database.js';
import { logger } from './utils/logger.js';

// Import models
import { userModel } from './models/User.js';
import { taskModel } from './models/Task.js';
import { candidateModel } from './models/Candidate.js';
import { refreshTokenModel } from './models/RefreshToken.js';
import { rolePermissionModel } from './models/RolePermission.js';

// Import services
import { authService } from './services/authService.js';
import { taskService } from './services/taskService.js';
import { userService } from './services/userService.js';

// Import middleware
import { globalErrorHandler, notFoundHandler } from './middleware/errorHandler.js';

// Import routes and socket manager
import apiRoutes from './routes/index.js';
import { graphMeetingController } from './controllers/graphMeetingController.js';
import { createSocketManager } from './sockets/index.js';
import { notificationCenter } from './notifications/index.js';

class Application {
  constructor() {
    this.app = express();
    this.server = null;
    this.socketManager = null;
    this.notificationCenter = notificationCenter;
  }

  async initialize() {
    try {
      logger.info('🚀 Starting Daily Dashboard Backend v2.0...');

      // Validate configuration
      validateConfig();
      logger.info('✅ Configuration validated');

      // Setup Express app
      this.setupExpress();

      // Connect to database
      await this.connectDatabase();

      // Initialize models
      await this.initializeModels();

      // Setup HTTP server and Socket.IO
      this.setupServer();

      // Setup Socket.IO
      await this.setupSocket();

      // Setup routes
      this.setupRoutes();

      // Setup error handling
      this.setupErrorHandling();

      // Setup graceful shutdown
      this.setupGracefulShutdown();

      logger.info('✅ Application initialized successfully');
    } catch (error) {
      logger.error('❌ Application initialization failed', { error: error.message });
      throw error;
    }
  }

  setupExpress() {
    this.app.use(cors(config.cors));
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));
    this.app.use(morgan(config.logging.format));

    // Security headers
    this.app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-XSS-Protection', '1; mode=block');
      next();
    });

    logger.info('✅ Express middleware configured');
  }

  async connectDatabase() {
    await database.connect();
  }

  async initializeModels() {
    await userModel.initialize();
    await taskModel.initialize();
    await candidateModel.initialize();
    await refreshTokenModel.initialize();
    await rolePermissionModel.initialize();

    logger.info('✅ Models initialized');
  }

  setupServer() {
    this.server = http.createServer(this.app);
    logger.info('✅ HTTP server created');
  }

  async setupSocket() {
    this.socketManager = createSocketManager(this.server);

    // Setup real-time task updates
    taskService.setupRealtimeUpdates(this.socketManager.getIO());

    await this.notificationCenter.initialize(this.socketManager.getIO());

    logger.info('✅ Socket.IO configured');
  }

  setupRoutes() {
    // API routes
    this.app.get('/auth/consent', (req, res) => graphMeetingController.startConsent(req, res));
    this.app.get('/auth/redirect', (req, res) => graphMeetingController.handleRedirect(req, res));
    this.app.use('/api', apiRoutes);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.status(200).json({
        message: 'Daily Dashboard API v2.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        documentation: '/api/info'
      });
    });

    logger.info('✅ Routes configured');
  }

  setupErrorHandling() {
    // 404 handler
    this.app.use(notFoundHandler);

    // Global error handler
    this.app.use(globalErrorHandler);

    // Unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Promise Rejection', {
        reason: reason?.message || reason,
        stack: reason?.stack
      });
    });

    // Uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });

    logger.info('✅ Error handling configured');
  }

  setupGracefulShutdown() {
    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);

      try {
        // Stop accepting new connections
        if (this.server) {
          this.server.close(() => {
            logger.info('HTTP server closed');
          });
        }

        // Close socket connections
        if (this.socketManager) {
          await this.socketManager.gracefulShutdown();
        }

        // Shutdown notification center
        this.notificationCenter?.shutdown();

        // Close database connection
        await database.disconnect();

        // Stop background jobs
        refreshTokenModel.stopCleanupJob();

        logger.info('✅ Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during graceful shutdown', { error: error.message });
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    logger.info('✅ Graceful shutdown handlers configured');
  }

  async start() {
    try {
      await this.initialize();

      this.server.listen(config.server.port, config.server.host, () => {
        logger.info(`🚀 Server running on http://${config.server.host}:${config.server.port}`);
        logger.info(`📊 Socket.IO enabled on the same port`);
        logger.info(`🔧 Environment: ${config.server.env}`);
        logger.info(`📡 New Relic monitoring: ${config.newRelic.enabled ? 'enabled' : 'disabled'}`);

        if (config.server.env === 'development') {
          logger.info(`📖 API Documentation: http://${config.server.host}:${config.server.port}/api/info`);
          logger.info(`🏥 Health Check: http://${config.server.host}:${config.server.port}/api/health`);
        }
      });
    } catch (error) {
      logger.error('❌ Failed to start server', { error: error.message });
      process.exit(1);
    }
  }

  // Utility methods for testing
  getApp() {
    return this.app;
  }

  getServer() {
    return this.server;
  }

  getSocketManager() {
    return this.socketManager;
  }

  async stop() {
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(resolve);
      });
    }
  }
}

// Start the application if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = new Application();
  app.start().catch((error) => {
    logger.error('Failed to start application', { error: error.message });
    process.exit(1);
  });
}

export { Application };
export default Application;
