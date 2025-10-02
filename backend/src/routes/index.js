import express from 'express';
import authRoutes from './auth.js';
import taskRoutes from './tasks.js';
import userRoutes from './users.js';
import docsRoutes from './docs.js';
import graphMeetingRoutes from './graphMeetings.js';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// API routes
router.use('/auth', authRoutes);
router.use('/tasks', taskRoutes);
router.use('/users', userRoutes);
router.use('/graph', graphMeetingRoutes);
router.use('/', docsRoutes);

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const dbHealth = await database.healthCheck();

    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth,
        api: {
          status: 'healthy',
          uptime: process.uptime(),
          timestamp: new Date().toISOString()
        }
      },
      environment: process.env.NODE_ENV || 'development'
    };

    res.status(200).json(health);
  } catch (error) {
    logger.error('Health check failed', { error: error.message });

    const health = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: {
          status: 'unhealthy',
          error: error.message,
          timestamp: new Date().toISOString()
        },
        api: {
          status: 'healthy',
          uptime: process.uptime(),
          timestamp: new Date().toISOString()
        }
      },
      environment: process.env.NODE_ENV || 'development'
    };

    res.status(503).json(health);
  }
});

// API info endpoint
router.get('/info', (req, res) => {
  res.status(200).json({
    name: 'Daily Dashboard API',
    version: '2.0.0',
    description: 'Scalable backend for daily dashboard application',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: '/api/auth',
      tasks: '/api/tasks',
      users: '/api/users',
      health: '/api/health',
      websocket: '/socket.io',
      openapi: '/api/docs/openapi.json'
    }
  });
});

// Catch-all for undefined API routes (Express 5 requires handler without wildcard string)
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

export default router;
