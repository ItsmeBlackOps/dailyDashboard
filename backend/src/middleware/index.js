/**
 * Middleware Collection
 *
 * Centralized middleware registration and configuration for Express.js
 * and Socket.IO with proper error handling and logging.
 */

import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';

import { config } from '../config/environment.js';
import { requestLogger, errorLogger } from '../utils/logger.js';
import { authMiddleware } from './auth.js';
import { errorHandlerMiddleware, notFoundMiddleware } from './errorHandler.js';
import { validationMiddleware } from './validation.js';
import { securityMiddleware } from './security.js';
import { performanceMiddleware } from './performance.js';

/**
 * Configure security-related middleware on the provided Express application.
 *
 * Applies HTTP security headers (including a Content Security Policy), CORS with configured origins and headers,
 * rate limiting for routes under /api/, and response compression with a configurable threshold and override header.
 *
 * @param {import('express').Application} app - The Express application instance to configure.
 */
export function setupSecurityMiddleware(app) {
  // Helmet for security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false
  }));

  // CORS configuration
  app.use(cors({
    origin: config.cors.origin,
    credentials: config.cors.credentials,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Request-ID',
      'Accept',
      'Origin'
    ]
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    skipSuccessfulRequests: config.rateLimit.skipSuccessfulRequests,
    message: {
      error: 'Too many requests from this IP, please try again later',
      statusCode: 429,
      timestamp: new Date().toISOString()
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return req.ip || req.connection.remoteAddress;
    }
  });

  app.use('/api/', limiter);

  // Compression
  app.use(compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
    level: 6,
    threshold: 1024
  }));
}

/**
 * Configure request body parsing: JSON and URL-encoded parsers with size limits, and raw body parsing for /api/webhooks.
 *
 * Applies:
 * - JSON parser: 10mb limit, strict mode, application/json only.
 * - URL-encoded parser: extended, 10mb limit, parameter limit 1000.
 * - Raw parser for /api/webhooks: application/json, 1mb limit.
 */
export function setupParsingMiddleware(app) {
  // Body parsing with size limits
  app.use(express.json({
    limit: '10mb',
    strict: true,
    type: ['application/json']
  }));

  app.use(express.urlencoded({
    extended: true,
    limit: '10mb',
    parameterLimit: 1000
  }));

  // Raw body for webhooks
  // Express 5 treats mount paths as prefixes, so `/api/webhooks` also matches nested routes
  app.use('/api/webhooks', express.raw({
    type: 'application/json',
    limit: '1mb'
  }));
}

/**
 * Registers HTTP request logging on the provided Express application.
 *
 * Adds a structured request logger for all routes and configures Morgan:
 * in development it uses the 'dev' format; otherwise it uses the 'combined'
 * format and skips logging responses with status codes less than 400.
 *
 * @param {import('express').Application} app - Express application instance to attach logging middleware to.
 */
export function setupLoggingMiddleware(app) {
  // Request logging
  app.use(requestLogger());

  // Morgan for additional HTTP logging (optional)
  if (config.app.environment === 'development') {
    app.use(morgan('dev'));
  } else {
    app.use(morgan('combined', {
      skip: (req, res) => res.statusCode < 400
    }));
  }
}

/**
 * Register API-specific middleware on the Express application.
 *
 * Applies performance tracking and security middleware to all routes under `/api`.
 * The request validation middleware is intentionally not applied here and is exported for per-route use.
 *
 * @param {import('express').Application} app - Express application to register middleware on.
 */
export function setupApiMiddleware(app) {
  // Custom performance tracking
  app.use('/api', performanceMiddleware());

  // Custom security middleware
  app.use('/api', securityMiddleware());

  // Validation middleware (applied per route)
  // Note: This is exported for use in specific routes
}

/**
 * Register the 404 handler, error logger, and global error handler on an Express application in the required order.
 *
 * The 404 handler is registered before the error logger and global error handler; the global error handler is registered last.
 * @param {import('express').Application} app - The Express application to configure.
 */
export function setupErrorMiddleware(app) {
  // 404 handler (must be before error handler)
  app.use(notFoundMiddleware);

  // Error logging
  app.use(errorLogger());

  // Global error handler (must be last)
  app.use(errorHandlerMiddleware);
}

/**
 * Register health, readiness, and liveness endpoints on the given Express application.
 *
 * Adds the following routes:
 * - GET /health: basic service health with timestamp, uptime, app version, environment, and memory usage.
 * - GET /ready: readiness status with timestamp and component checks (e.g., database, memory).
 * - GET /live: liveness status with timestamp.
 *
 * The responses are JSON objects describing the current state; readiness checks are intended to be extended
 * with dynamic checks for external dependencies (databases, caches, etc.).
 *
 * @param {import('express').Application} app - Express application instance to attach the endpoints to.
 */
export function setupHealthCheck(app) {
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: config.app.version,
      environment: config.app.environment,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024 * 100) / 100
      }
    });
  });

  // Readiness check
  app.get('/ready', (req, res) => {
    // Add checks for database, external services, etc.
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'connected', // This would be dynamic in real implementation
        memory: process.memoryUsage().heapUsed < 1024 * 1024 * 1024 // Less than 1GB
      }
    });
  });

  // Liveness check
  app.get('/live', (req, res) => {
    res.status(200).json({
      status: 'alive',
      timestamp: new Date().toISOString()
    });
  });
}

/**
 * Register and configure all server middleware on the given Express application in the required order.
 *
 * Ensures security and parsing are applied before logging and API middleware, and that error handling is registered last.
 * @param {import('express').Application} app - The Express application to attach middleware to.
 */
export function setupMiddleware(app) {
  // Security must be first
  setupSecurityMiddleware(app);

  // Parsing middleware
  setupParsingMiddleware(app);

  // Logging middleware
  setupLoggingMiddleware(app);

  // Health checks
  setupHealthCheck(app);

  // API-specific middleware
  setupApiMiddleware(app);

  // Error handling must be last
  setupErrorMiddleware(app);
}

/**
 * Export individual middleware functions for specific use
 */
export {
  authMiddleware,
  validationMiddleware,
  errorHandlerMiddleware,
  notFoundMiddleware,
  securityMiddleware,
  performanceMiddleware
};
