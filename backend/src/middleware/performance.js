/**
 * Performance Middleware
 *
 * Tracks performance metrics, monitors resource usage,
 * and provides optimization recommendations.
 */

import { logger, createTimer } from '../utils/logger.js';
import { config } from '../config/environment.js';

/**
 * Create Express middleware that measures per-request duration and memory usage and logs performance metrics.
 *
 * The middleware increments and decrements req.app.locals.activeRequests, captures high-resolution timing and memory
 * snapshots at request start and response end, computes deltas, logs categorized messages based on duration and memory
 * thresholds, sets the `X-Response-Time` and `X-Memory-Usage` response headers, and returns control to the next
 * middleware.
 *
 * @returns {Function} An Express middleware function (req, res, next) that records timing and memory metrics, sets
 * response headers, and emits structured performance logs and warnings when thresholds are exceeded.
 */
export function performanceMiddleware() {
  const performanceLogger = logger.child('performance');
  const slowQueryThreshold = 1000; // 1 second
  const memoryWarningThreshold = 0.8; // 80% of heap limit

  return (req, res, next) => {
    const timer = createTimer(`${req.method} ${req.url}`, performanceLogger);
    const startTime = process.hrtime.bigint();
    const startMemory = process.memoryUsage();

    // Track active requests
    req.app.locals.activeRequests = (req.app.locals.activeRequests || 0) + 1;

    // Override res.end to capture metrics
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
      const endMemory = process.memoryUsage();

      // Calculate memory delta
      const memoryDelta = {
        heapUsed: endMemory.heapUsed - startMemory.heapUsed,
        heapTotal: endMemory.heapTotal - startMemory.heapTotal,
        external: endMemory.external - startMemory.external,
        rss: endMemory.rss - startMemory.rss
      };

      // Performance metrics
      const metrics = {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration: Math.round(duration * 100) / 100,
        memory: {
          start: startMemory,
          end: endMemory,
          delta: memoryDelta
        },
        headers: {
          contentLength: res.get('Content-Length'),
          contentType: res.get('Content-Type')
        },
        userAgent: req.get('User-Agent'),
        ip: req.ip
      };

      // Log performance based on duration
      if (duration > slowQueryThreshold) {
        performanceLogger.warn('Slow request detected', metrics);
      } else if (duration > 500) {
        performanceLogger.info('Request completed', metrics);
      } else {
        performanceLogger.debug('Request completed', metrics);
      }

      // Check memory usage
      const memoryUsagePercent = endMemory.heapUsed / endMemory.heapTotal;
      if (memoryUsagePercent > memoryWarningThreshold) {
        performanceLogger.warn('High memory usage detected', {
          heapUsed: Math.round(endMemory.heapUsed / 1024 / 1024),
          heapTotal: Math.round(endMemory.heapTotal / 1024 / 1024),
          usagePercent: Math.round(memoryUsagePercent * 100),
          url: req.url
        });
      }

      // Decrease active requests counter
      req.app.locals.activeRequests = Math.max(0, (req.app.locals.activeRequests || 0) - 1);

      // Set performance headers
      res.setHeader('X-Response-Time', `${Math.round(duration)}ms`);
      res.setHeader('X-Memory-Usage', `${Math.round(endMemory.heapUsed / 1024 / 1024)}MB`);

      // End timer
      timer.end();

      // Call original end
      originalEnd.call(res, chunk, encoding);
    };

    next();
  };
}

/**
 * Periodically captures and logs system resource snapshots (CPU, memory, uptime, and active requests)
 * and emits warnings when predefined thresholds are exceeded.
 *
 * Runs checks at ~30 second intervals and logs a structured resource update; logs a warning if
 * heap usage exceeds 512 MB or if concurrent active requests exceed 100.
 *
 * @returns {import('express').RequestHandler} Express middleware that performs periodic resource logging and threshold warnings.
 */
export function resourceMonitoringMiddleware() {
  const resourceLogger = logger.child('resources');
  let lastCheck = Date.now();
  let lastCpuUsage = process.cpuUsage();

  return (req, res, next) => {
    const now = Date.now();

    // Check resources every 30 seconds
    if (now - lastCheck > 30000) {
      const currentCpuUsage = process.cpuUsage(lastCpuUsage);
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();

      const resources = {
        timestamp: new Date().toISOString(),
        uptime: Math.round(uptime),
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          external: Math.round(memoryUsage.external / 1024 / 1024),
          rss: Math.round(memoryUsage.rss / 1024 / 1024)
        },
        cpu: {
          user: Math.round(currentCpuUsage.user / 1000), // Convert to milliseconds
          system: Math.round(currentCpuUsage.system / 1000)
        },
        activeRequests: req.app.locals.activeRequests || 0
      };

      // Log resource usage
      resourceLogger.info('Resource usage update', resources);

      // Warn if resources are high
      if (resources.memory.heapUsed > 512) { // More than 512MB
        resourceLogger.warn('High memory usage', { heapUsed: resources.memory.heapUsed });
      }

      if (resources.activeRequests > 100) {
        resourceLogger.warn('High concurrent requests', { activeRequests: resources.activeRequests });
      }

      lastCheck = now;
      lastCpuUsage = process.cpuUsage();
    }

    next();
  };
}

/**
 * Create Express middleware that annotates JSON responses with size information and compression hints.
 *
 * The middleware sets the `X-Response-Size` header for JSON responses, sets `X-Compression-Recommended` when the response size exceeds 1024 bytes and no `Content-Encoding` is present, and logs responses larger than 100 KB.
 * @returns {Function} An Express middleware function. 
 */
export function compressionOptimizer() {
  return (req, res, next) => {
    const originalJson = res.json;

    res.json = function(data) {
      // Calculate response size
      const responseSize = JSON.stringify(data).length;

      // Add size headers
      res.setHeader('X-Response-Size', responseSize);

      // Recommend compression for large responses
      if (responseSize > 1024 && !res.get('Content-Encoding')) {
        res.setHeader('X-Compression-Recommended', 'true');
      }

      // Log large responses
      if (responseSize > 100000) { // 100KB
        logger.performance('Large response', responseSize, {
          url: req.url,
          size: responseSize,
          method: req.method
        });
      }

      return originalJson.call(this, data);
    };

    next();
  };
}

/**
 * Create Express middleware that records per-request database query timings and emits a summary when the response ends.
 *
 * The middleware attaches:
 * - `req.dbQueries` — an array collecting recorded queries for the request.
 * - `req.trackDbQuery(operation, collection, query)` — helper that returns `{ end(result) }`; calling `end` records the operation, collection, duration, a simple measurement of the `query` size, and `resultCount`, and logs individual slow queries (duration > 1000 ms).
 *
 * When the response finishes, the middleware logs a database queries summary (URL, query count, total DB time, list of queries) and emits warnings when query count exceeds 10 or total DB time exceeds 2000 ms.
 *
 * @returns {Function} Express middleware that instruments and summarizes database query performance per request.
 */
export function databasePerformanceTracker() {
  return (req, res, next) => {
    // Store database query start times
    req.dbQueries = [];

    // Helper function to track database operations
    req.trackDbQuery = (operation, collection, query = {}) => {
      const queryTimer = createTimer(`DB ${operation} ${collection}`);

      return {
        end: (result = {}) => {
          const duration = queryTimer.end();

          req.dbQueries.push({
            operation,
            collection,
            duration,
            query: typeof query === 'object' ? Object.keys(query).length : 'complex',
            resultCount: Array.isArray(result) ? result.length : (result.length || 1)
          });

          // Log slow queries
          if (duration > 1000) { // Slower than 1 second
            logger.warn('Slow database query', {
              operation,
              collection,
              duration,
              url: req.url
            });
          }

          return result;
        }
      };
    };

    // Override res.end to log database performance summary
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
      if (req.dbQueries && req.dbQueries.length > 0) {
        const totalDbTime = req.dbQueries.reduce((sum, query) => sum + query.duration, 0);
        const queryCount = req.dbQueries.length;

        logger.performance('Database queries summary', totalDbTime, {
          url: req.url,
          queryCount,
          totalDbTime,
          queries: req.dbQueries
        });

        // Warn about query efficiency
        if (queryCount > 10) {
          logger.warn('High number of database queries', {
            url: req.url,
            queryCount,
            suggestion: 'Consider optimizing with aggregation or joins'
          });
        }

        if (totalDbTime > 2000) { // More than 2 seconds total
          logger.warn('High total database time', {
            url: req.url,
            totalDbTime,
            suggestion: 'Consider adding database indexes or caching'
          });
        }
      }

      originalEnd.call(res, chunk, encoding);
    };

    next();
  };
}

/**
 * Create Express middleware that tracks per-request cache hits and misses, logs cache metrics when the response completes, and exposes helpers to record cache events.
 *
 * When requests include cache activity, the middleware logs a performance event with URL, hit/miss counts, hit rate, and total attempts; sets headers `X-Cache-Hits`, `X-Cache-Misses`, and `X-Cache-Hit-Rate`; and emits a warning when the hit rate is below 50% with more than 5 attempts.
 *
 * @returns {import('express').RequestHandler} Express middleware that:
 *  - initializes `req.cacheHits` and `req.cacheMisses`,
 *  - provides `req.recordCacheHit()` and `req.recordCacheMiss()` helpers,
 *  - logs cache performance and sets response headers on response end.
 */
export function cachePerformanceMiddleware() {
  return (req, res, next) => {
    req.cacheHits = 0;
    req.cacheMisses = 0;

    // Helper functions for cache tracking
    req.recordCacheHit = () => {
      req.cacheHits++;
    };

    req.recordCacheMiss = () => {
      req.cacheMisses++;
    };

    // Log cache performance on response
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
      const totalCacheAttempts = req.cacheHits + req.cacheMisses;

      if (totalCacheAttempts > 0) {
        const hitRate = (req.cacheHits / totalCacheAttempts) * 100;

        logger.performance('Cache performance', 0, {
          url: req.url,
          cacheHits: req.cacheHits,
          cacheMisses: req.cacheMisses,
          hitRate: Math.round(hitRate * 100) / 100,
          totalAttempts: totalCacheAttempts
        });

        // Set cache performance headers
        res.setHeader('X-Cache-Hits', req.cacheHits);
        res.setHeader('X-Cache-Misses', req.cacheMisses);
        res.setHeader('X-Cache-Hit-Rate', `${Math.round(hitRate)}%`);

        // Warn about poor cache performance
        if (hitRate < 50 && totalCacheAttempts > 5) {
          logger.warn('Poor cache hit rate', {
            url: req.url,
            hitRate,
            suggestion: 'Consider improving cache strategy'
          });
        }
      }

      originalEnd.call(res, chunk, encoding);
    };

    next();
  };
}

/**
 * Create middleware that samples process memory over time and warns on rapid heap growth.
 *
 * The returned middleware records periodic memory snapshots (per request) into a rolling window
 * and emits a warning when the observed heap-used growth rate exceeds 1,000 bytes per millisecond
 * (approximately 1 MB/s).
 *
 * @returns {function} Express middleware (req, res, next) that captures memory samples and logs a warning when a potential memory leak is detected.
 */
export function memoryLeakDetection() {
  let samples = [];
  const maxSamples = 10;

  return (req, res, next) => {
    const memoryUsage = process.memoryUsage();

    // Add current sample
    samples.push({
      timestamp: Date.now(),
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal
    });

    // Keep only recent samples
    if (samples.length > maxSamples) {
      samples = samples.slice(-maxSamples);
    }

    // Analyze trend if we have enough samples
    if (samples.length >= maxSamples) {
      const first = samples[0];
      const last = samples[samples.length - 1];
      const timeDiff = last.timestamp - first.timestamp;
      const heapGrowth = last.heapUsed - first.heapUsed;
      const growthRate = heapGrowth / timeDiff; // bytes per millisecond

      // Warn if memory is growing consistently
      if (growthRate > 1000) { // More than 1MB per second growth
        logger.warn('Potential memory leak detected', {
          growthRate: Math.round(growthRate * 1000), // bytes per second
          heapGrowth: Math.round(heapGrowth / 1024 / 1024), // MB
          timeWindow: Math.round(timeDiff / 1000), // seconds
          currentHeap: Math.round(last.heapUsed / 1024 / 1024) // MB
        });
      }
    }

    next();
  };
}