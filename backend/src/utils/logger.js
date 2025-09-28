/**
 * Enhanced Logger Utility
 *
 * Provides structured logging with different levels, formatting options,
 * and context tracking for better debugging and monitoring.
 */

import moment from 'moment-timezone';

/**
 * Obtain runtime logging configuration with safe fallbacks for early initialization.
 * @returns {{level: string, format: string, isDevelopment: boolean, isProduction: boolean}} Configuration object:
 *  - level: selected log level (e.g., "info").
 *  - format: log output format (e.g., "json" or "pretty").
 *  - isDevelopment: `true` when NODE_ENV === "development".
 *  - isProduction: `true` when NODE_ENV === "production".
 */
function getLogConfig() {
  try {
    // Try to get config, but provide fallbacks for early initialization
    const env = process.env.NODE_ENV || 'development';
    const level = process.env.LOG_LEVEL || 'info';
    const logFormat = process.env.LOG_FORMAT || 'json';

    return {
      level,
      format: logFormat,
      isDevelopment: env === 'development',
      isProduction: env === 'production'
    };
  } catch {
    return {
      level: 'info',
      format: 'json',
      isDevelopment: true,
      isProduction: false
    };
  }
}

const logConfig = getLogConfig();

/**
 * Enhanced logger with context support
 */
class Logger {
  constructor(context = '') {
    this.context = context;
    this.requestId = null;
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      verbose: 4
    };
    this.currentLevel = this.levels[logConfig.level] || this.levels.info;
  }

  /**
   * Set request ID for request-scoped logging
   */
  setRequestId(requestId) {
    this.requestId = requestId;
    return this;
  }

  /**
   * Create child logger with context
   */
  child(context) {
    const childLogger = new Logger(context);
    childLogger.requestId = this.requestId;
    return childLogger;
  }

  /**
   * Sanitize sensitive data
   */
  sanitizeObject(obj, path = '') {
    if (!obj || typeof obj !== 'object') return obj;

    const sensitiveFields = [
      'password', 'token', 'accessToken', 'refreshToken',
      'secret', 'key', 'authorization', 'cookie', 'session'
    ];

    const sanitized = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      const fullPath = path ? `${path}.${key}` : key;
      const lowerKey = key.toLowerCase();

      if (sensitiveFields.some(field => lowerKey.includes(field))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeObject(value, fullPath);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Format message with context
   */
  formatMessage(level, message, meta = {}) {
    const timestamp = moment().tz('UTC').format('YYYY-MM-DD HH:mm:ss.SSS');
    const contextPrefix = this.context ? `[${this.context}] ` : '';
    const requestIdPrefix = this.requestId ? `[${this.requestId}] ` : '';
    const formattedMessage = `${contextPrefix}${requestIdPrefix}${message}`;

    const sanitizedMeta = this.sanitizeObject({
      ...meta,
      ...(this.context && { context: this.context }),
      ...(this.requestId && { requestId: this.requestId })
    });

    if (logConfig.isDevelopment) {
      const metaStr = Object.keys(sanitizedMeta).length ? `\n${JSON.stringify(sanitizedMeta, null, 2)}` : '';
      return `[${timestamp}] ${level.toUpperCase()}: ${formattedMessage}${metaStr}`;
    } else {
      return JSON.stringify({
        timestamp,
        level: level.toUpperCase(),
        message: formattedMessage,
        ...sanitizedMeta
      });
    }
  }

  /**
   * Base log method
   */
  log(level, message, meta = {}) {
    if (this.levels[level] <= this.currentLevel) {
      console.log(this.formatMessage(level, message, meta));
    }
  }

  /**
   * Log at error level
   */
  error(message, meta = {}) {
    this.log('error', message, meta);
  }

  /**
   * Log at warn level
   */
  warn(message, meta = {}) {
    this.log('warn', message, meta);
  }

  /**
   * Log at info level
   */
  info(message, meta = {}) {
    this.log('info', message, meta);
  }

  /**
   * Log at debug level
   */
  debug(message, meta = {}) {
    this.log('debug', message, meta);
  }

  /**
   * Log at verbose level
   */
  verbose(message, meta = {}) {
    this.log('verbose', message, meta);
  }

  /**
   * Log HTTP request
   */
  http(method, url, statusCode, responseTime, meta = {}) {
    const message = `${method} ${url} ${statusCode} - ${responseTime}ms`;
    this.info(message, {
      ...meta,
      type: 'http_request',
      method,
      url,
      statusCode,
      responseTime
    });
  }

  /**
   * Log socket event
   */
  socket(event, socketId, data = {}, meta = {}) {
    const message = `Socket ${event} [${socketId}]`;
    this.debug(message, {
      ...meta,
      type: 'socket_event',
      event,
      socketId,
      data
    });
  }

  /**
   * Log database operation
   */
  database(operation, collection, data = {}, meta = {}) {
    const message = `Database ${operation} on ${collection}`;
    this.debug(message, {
      ...meta,
      type: 'database_operation',
      operation,
      collection,
      data
    });
  }

  /**
   * Log performance metric
   */
  performance(operation, duration, meta = {}) {
    const message = `Performance: ${operation} took ${duration}ms`;

    // Use different log levels based on duration
    if (duration > 5000) {
      this.warn(message, { ...meta, type: 'performance', operation, duration });
    } else if (duration > 1000) {
      this.info(message, { ...meta, type: 'performance', operation, duration });
    } else {
      this.debug(message, { ...meta, type: 'performance', operation, duration });
    }
  }

  /**
   * Log security event
   */
  security(event, level = 'warn', meta = {}) {
    const message = `Security: ${event}`;
    this[level](message, {
      ...meta,
      type: 'security_event',
      event
    });
  }

  /**
   * Log business event
   */
  business(event, meta = {}) {
    const message = `Business: ${event}`;
    this.info(message, {
      ...meta,
      type: 'business_event',
      event
    });
  }
}

/**
 * Create default logger instance
 */
const logger = new Logger();

/**
 * Create a simple timer for measuring an operation's duration and emitting a performance log.
 *
 * The returned object exposes an `end(meta = {})` method which computes the elapsed time
 * in milliseconds since creation, logs a performance event via the provided logger, and
 * returns the duration.
 *
 * @param {string} operation - Human-readable name of the operation being measured.
 * @param {Logger} [loggerInstance] - Logger used to emit the performance event (defaults to module logger).
 * @returns {number} Duration of the operation in milliseconds.
 */
export function createTimer(operation, loggerInstance = logger) {
  const startTime = Date.now();

  return {
    end: (meta = {}) => {
      const duration = Date.now() - startTime;
      loggerInstance.performance(operation, duration, meta);
      return duration;
    }
  };
}

/**
 * Attach a request-scoped logger to incoming requests and log request start and completion.
 *
 * The middleware assigns a requestId (from the `x-request-id` or `request-id` header, or a generated id)
 * to `req.requestId`, creates `req.logger` (a Logger instance bound to that id), logs a debug-level
 * "Request started" entry, and overrides `res.end` to log an HTTP completion entry including status,
 * response time, content length, user agent, and IP.
 *
 * @returns {Function} Express-compatible middleware function (req, res, next).
 */
export function requestLogger() {
  return (req, res, next) => {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] ||
                     req.headers['request-id'] ||
                     Math.random().toString(36).substr(2, 9);

    // Add request ID to request object
    req.requestId = requestId;

    // Create request-scoped logger
    req.logger = new Logger().setRequestId(requestId);

    // Log request start
    req.logger.debug('Request started', {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
      const responseTime = Date.now() - startTime;

      req.logger.http(
        req.method,
        req.url,
        res.statusCode,
        responseTime,
        {
          contentLength: res.get('Content-Length'),
          userAgent: req.get('User-Agent'),
          ip: req.ip
        }
      );

      originalEnd.call(res, chunk, encoding);
    };

    next();
  };
}

/**
 * Creates an Express error-handling middleware that logs the error along with request context and forwards the error.
 *
 * The middleware logs the error message and stack plus request details: HTTP method, URL, status code (from error.statusCode or 500),
 * User-Agent header, and request IP.
 *
 * @returns {Function} An Express error-handling middleware function with signature (err, req, res, next) that logs the error and calls `next(err)`.
 */
export function errorLogger() {
  return (err, req, res, next) => {
    const loggerInstance = req.logger || logger;

    loggerInstance.error('Request error', {
      error: err.message,
      stack: err.stack,
      method: req.method,
      url: req.url,
      statusCode: err.statusCode || 500,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });

    next(err);
  };
}

/**
 * Register process handlers for graceful shutdown and fatal-error logging.
 *
 * Registers listeners for SIGTERM and SIGINT to log shutdown initiation.
 * Logs uncaught exceptions and unhandled promise rejections with details and exits the process with code 1.
 */
export function setupGracefulShutdown() {
  const shutdownLogger = logger.child('shutdown');

  process.on('SIGTERM', () => {
    shutdownLogger.info('Received SIGTERM, starting graceful shutdown');
  });

  process.on('SIGINT', () => {
    shutdownLogger.info('Received SIGINT, starting graceful shutdown');
  });

  process.on('uncaughtException', (error) => {
    shutdownLogger.error('Uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    shutdownLogger.error('Unhandled rejection', { reason, promise });
    process.exit(1);
  });
}

export { Logger, logger };
export default logger;