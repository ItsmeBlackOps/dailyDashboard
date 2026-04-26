import express from 'express';
import authRoutes from './auth.js';
import taskRoutes from './tasks.js';
import userRoutes from './users.js';
import docsRoutes from './docs.js';
import graphMeetingRoutes from './graphMeetings.js';
import supportRoutes from './supportRequests.js';
import profileRoutes from './profile.js';
import candidateRoutes from './candidates.js';
import notificationRoutes from './notificationRoutes.js';
import permissionRoutes from './permissionRoutes.js';
import transcriptRequestRoutes from './transcriptRequests.js';
import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';

async function adminPerformance(req, res) {
  if (req.user?.role !== 'admin') return res.status(403).json({ success: false, error: 'admin only' });
  try {
    const db = database.getDb();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pipeline = [
      { $match: { createdAt: { $gte: since } } },
      {
        $group: {
          _id: { user: '$userEmail', role: '$userRole' },
          avgMs: { $avg: '$durationMs' },
          maxMs: { $max: '$durationMs' },
          requests: { $sum: 1 },
          slowRequests: { $sum: { $cond: [{ $gt: ['$durationMs', 1000] }, 1, 0] } },
        }
      },
      { $sort: { avgMs: -1 } },
      { $limit: 200 },
    ];
    const rows = await db.collection('perfMetrics').aggregate(pipeline).toArray();
    return res.json({
      success: true, since, rows: rows.map(r => ({
        email: r._id.user || '(unauth)',
        role: r._id.role || '',
        avgMs: Math.round(r.avgMs),
        maxMs: r.maxMs,
        requests: r.requests,
        slowRequests: r.slowRequests,
      }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

import dashboardRoutes from './dashboardRoutes.js';
import poRoutes from './po.js';

const router = express.Router();

// API routes
router.use('/auth', authRoutes);
router.use('/tasks', taskRoutes);
router.use('/users', userRoutes);
router.use('/graph', graphMeetingRoutes);
router.use('/support', supportRoutes);
router.use('/profile', profileRoutes);
router.use('/candidates', candidateRoutes);
router.use('/notifications', notificationRoutes);
router.use('/permissions', permissionRoutes);
router.use('/transcript-requests', transcriptRequestRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/po', poRoutes);
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

// Admin performance endpoint
router.get('/admin/performance', adminPerformance);

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
