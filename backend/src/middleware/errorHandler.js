import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export const globalErrorHandler = (err, req, res, next) => {
  // Log the error
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    user: req.user?.email || 'anonymous'
  });

  // Don't expose internal errors in production
  const isDevelopment = config.server.env === 'development';

  let statusCode = 500;
  let message = 'Internal server error';
  let details = null;

  if (typeof err.statusCode === 'number') {
    statusCode = err.statusCode;
    if (err.message) {
      message = err.message;
    }
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    const maxBytes = config.support?.attachmentMaxBytes ?? 5 * 1024 * 1024;
    const sizeMb = (maxBytes / (1024 * 1024)).toFixed(1);
    message = `File exceeds the maximum allowed size of ${sizeMb} MB`;
  }

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation error';
    details = err.details || err.message;
  } else if (err.name === 'UnauthorizedError' || err.message.includes('Unauthorized')) {
    statusCode = 401;
    message = 'Unauthorized';
  } else if (err.name === 'ForbiddenError' || err.message.includes('Forbidden')) {
    statusCode = 403;
    message = 'Forbidden';
  } else if (err.name === 'NotFoundError' || err.message.includes('Not found')) {
    statusCode = 404;
    message = 'Not found';
  } else if (err.name === 'MongoError' || err.name === 'MongoServerError') {
    statusCode = 500;
    message = 'Database error';

    // Handle specific MongoDB errors
    if (err.code === 11000) {
      statusCode = 409;
      message = 'Duplicate entry';
      details = 'Resource already exists';
    }
  }

  // Prepare response
  const response = {
    success: false,
    error: message,
    timestamp: new Date().toISOString()
  };

  // Include details in development or for client errors
  if (isDevelopment || statusCode < 500) {
    response.details = details || (isDevelopment ? err.stack : undefined);
  }

  res.status(statusCode).json(response);
};

export const notFoundHandler = (req, res) => {
  logger.warn('Route not found', {
    path: req.path,
    method: req.method,
    user: req.user?.email || 'anonymous'
  });

  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
};

export const socketErrorHandler = (socket, error) => {
  logger.error('Socket error', {
    error: error.message,
    socketId: socket.id,
    user: socket.data.user?.email || 'anonymous'
  });

  socket.emit('error', {
    success: false,
    error: 'Socket error occurred',
    timestamp: new Date().toISOString()
  });
};

export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export const socketAsyncHandler = (fn) => {
  return async function (...args) {
    const socket = this;
    const potentialCallback = args[args.length - 1];
    const callback = typeof potentialCallback === 'function' ? potentialCallback : undefined;

    try {
      await fn(socket, ...args);
    } catch (error) {
      logger.error('Socket handler error', {
        error: error.message,
        socketId: socket.id,
        user: socket.data.user?.email || 'anonymous'
      });

      if (callback) {
        callback({
          success: false,
          error: 'Internal server error',
          timestamp: new Date().toISOString()
        });
      } else {
        socket.emit('error', {
          success: false,
          error: 'Internal server error',
          timestamp: new Date().toISOString()
        });
      }
    }
  };
};

export const rateLimitHandler = (req, res) => {
  logger.warn('Rate limit exceeded', {
    ip: req.ip,
    path: req.path,
    user: req.user?.email || 'anonymous'
  });

  res.status(429).json({
    success: false,
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please try again later.',
    timestamp: new Date().toISOString()
  });
};
