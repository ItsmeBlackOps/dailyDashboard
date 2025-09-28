import { Server } from 'socket.io';
import { config } from '../config/index.js';
import { authenticateSocket } from '../middleware/auth.js';
import { authSocketHandler } from './authSocket.js';
import { taskSocketHandler } from './taskSocket.js';
import { candidateSocketHandler } from './candidateSocket.js';
import { socketErrorHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

export class SocketManager {
  constructor(server) {
    this.io = new Server(server, config.socket);
    this.setupMiddleware();
    this.setupConnectionHandler();
  }

  setupMiddleware() {
    this.io.use(authenticateSocket);
    logger.info('Socket middleware configured');
  }

  setupConnectionHandler() {
    this.io.on('connection', (socket) => {
      logger.info('Socket connected', {
        socketId: socket.id,
        userEmail: socket.data.user?.email || 'anonymous',
        userRole: socket.data.user?.role || 'none'
      });

      // Setup error handling for this socket
      socket.on('error', (error) => {
        socketErrorHandler(socket, error);
      });

      // Setup disconnect handling
      socket.on('disconnect', (reason) => {
        logger.info('Socket disconnected', {
          socketId: socket.id,
          reason,
          userEmail: socket.data.user?.email || 'anonymous'
        });
      });

      // Register all socket handlers
      this.registerHandlers(socket);
    });

    logger.info('Socket connection handler configured');
  }

  registerHandlers(socket) {
    try {
      // Auth handlers
      authSocketHandler.handleConnection(socket);

      // Task handlers
      taskSocketHandler.handleConnection(socket);

      // Candidate handlers
      candidateSocketHandler.handleConnection(socket);

      // Health check handler
      socket.on('ping', (callback) => {
        if (callback && typeof callback === 'function') {
          callback({
            success: true,
            timestamp: new Date().toISOString(),
            socketId: socket.id
          });
        }
      });

      // User info handler
      socket.on('getUserInfo', (callback) => {
        if (callback && typeof callback === 'function') {
          const user = socket.data.user;
          callback({
            success: true,
            user: user ? {
              email: user.email,
              role: user.role,
              teamLead: user.teamLead,
              manager: user.manager
            } : null,
            authenticated: !!user
          });
        }
      });

      logger.debug('Socket handlers registered', { socketId: socket.id });

    } catch (error) {
      logger.error('Failed to register socket handlers', {
        error: error.message,
        socketId: socket.id
      });
    }
  }

  // Utility methods for broadcasting
  broadcastToRole(role, event, data) {
    try {
      const sockets = Array.from(this.io.of("/").sockets.values());
      const targetSockets = sockets.filter(socket => socket.data.user?.role === role);

      targetSockets.forEach(socket => {
        socket.emit(event, data);
      });

      logger.debug('Broadcast to role completed', {
        role,
        event,
        targetCount: targetSockets.length
      });

    } catch (error) {
      logger.error('Failed to broadcast to role', {
        error: error.message,
        role,
        event
      });
    }
  }

  broadcastToUser(email, event, data) {
    try {
      const sockets = Array.from(this.io.of("/").sockets.values());
      const targetSockets = sockets.filter(socket =>
        socket.data.user?.email?.toLowerCase() === email.toLowerCase()
      );

      targetSockets.forEach(socket => {
        socket.emit(event, data);
      });

      logger.debug('Broadcast to user completed', {
        email,
        event,
        targetCount: targetSockets.length
      });

    } catch (error) {
      logger.error('Failed to broadcast to user', {
        error: error.message,
        email,
        event
      });
    }
  }

  broadcastToAll(event, data) {
    try {
      this.io.emit(event, data);

      logger.debug('Broadcast to all completed', {
        event,
        totalSockets: this.io.of("/").sockets.size
      });

    } catch (error) {
      logger.error('Failed to broadcast to all', {
        error: error.message,
        event
      });
    }
  }

  getConnectionStats() {
    try {
      const sockets = Array.from(this.io.of("/").sockets.values());

      const stats = {
        total: sockets.length,
        authenticated: sockets.filter(s => s.data.user).length,
        anonymous: sockets.filter(s => !s.data.user).length,
        byRole: {},
        timestamp: new Date().toISOString()
      };

      // Count by role
      sockets.forEach(socket => {
        const role = socket.data.user?.role || 'anonymous';
        stats.byRole[role] = (stats.byRole[role] || 0) + 1;
      });

      return stats;
    } catch (error) {
      logger.error('Failed to get connection stats', { error: error.message });
      return {
        total: 0,
        authenticated: 0,
        anonymous: 0,
        byRole: {},
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  getIO() {
    return this.io;
  }

  async gracefulShutdown() {
    try {
      logger.info('Starting socket server graceful shutdown...');

      // Notify all connected clients
      this.broadcastToAll('serverShutdown', {
        message: 'Server is shutting down',
        timestamp: new Date().toISOString()
      });

      // Wait a bit for messages to be sent
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Close the server
      this.io.close();

      logger.info('Socket server shutdown completed');
    } catch (error) {
      logger.error('Error during socket server shutdown', { error: error.message });
    }
  }
}

export const createSocketManager = (server) => {
  return new SocketManager(server);
};
