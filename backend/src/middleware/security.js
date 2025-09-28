/**
 * Security Middleware
 *
 * Additional security measures beyond helmet and basic CORS.
 * Includes input sanitization, IP filtering, and security headers.
 */

import { logger } from '../utils/logger.js';
import { config } from '../config/environment.js';

/**
 * Create an Express middleware that hardens requests by setting security headers, removing sensitive headers,
 * inspecting request content for suspicious patterns, applying a simple per-IP rate limit, and logging security-relevant events.
 * @returns {import('express').RequestHandler} Express middleware that enforces header hygiene, content checks, rate limiting, and security logging.
 */
export function securityMiddleware() {
  const securityLogger = logger.child('security');

  return (req, res, next) => {
    // Add security headers
    res.setHeader('X-Request-ID', req.requestId || 'unknown');
    res.setHeader('X-Response-Time', Date.now());

    // Remove sensitive headers
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');

    // Log security-relevant information
    const securityContext = {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      origin: req.get('Origin'),
      referer: req.get('Referer'),
      method: req.method,
      url: req.url
    };

    // Check for suspicious patterns
    const suspiciousPatterns = [
      /(<script[^>]*>.*?<\/script>)/gi,  // Script injection
      /(javascript:)/gi,                 // JavaScript protocol
      /(data:text\/html)/gi,            // Data URL HTML
      /(\bselect\b.*\bfrom\b)/gi,       // SQL injection
      /(\bunion\b.*\bselect\b)/gi,      // SQL union
      /((\%27)|(\'))((\%6F)|o|(\%4F))((\%72)|r|(\%52))/gi, // SQL injection
      /exec(\s|\+)+(s|x)p\w+/gi         // Command injection
    ];

    // Check URL and query parameters
    const fullUrl = req.url + JSON.stringify(req.query) + JSON.stringify(req.body || {});

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(fullUrl)) {
        securityLogger.security('Suspicious request pattern detected', 'warn', {
          ...securityContext,
          pattern: pattern.toString(),
          suspiciousContent: fullUrl
        });

        return res.status(400).json({
          error: 'Bad Request',
          message: 'Request contains invalid characters',
          statusCode: 400,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Rate limiting by IP (additional to express-rate-limit)
    const requestsPerMinute = req.app.locals.requestCount = req.app.locals.requestCount || {};
    const clientIP = req.ip;
    const currentMinute = Math.floor(Date.now() / 60000);

    if (!requestsPerMinute[clientIP]) {
      requestsPerMinute[clientIP] = {};
    }

    if (!requestsPerMinute[clientIP][currentMinute]) {
      requestsPerMinute[clientIP][currentMinute] = 0;
    }

    requestsPerMinute[clientIP][currentMinute]++;

    // Clean old entries
    Object.keys(requestsPerMinute).forEach(ip => {
      Object.keys(requestsPerMinute[ip]).forEach(minute => {
        if (parseInt(minute) < currentMinute - 5) { // Keep last 5 minutes
          delete requestsPerMinute[ip][minute];
        }
      });
      if (Object.keys(requestsPerMinute[ip]).length === 0) {
        delete requestsPerMinute[ip];
      }
    });

    // Check if client exceeded custom rate limit
    if (requestsPerMinute[clientIP][currentMinute] > 200) { // 200 requests per minute
      securityLogger.security('Client exceeded rate limit', 'warn', {
        ...securityContext,
        requestsThisMinute: requestsPerMinute[clientIP][currentMinute]
      });

      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded',
        statusCode: 429,
        retryAfter: 60,
        timestamp: new Date().toISOString()
      });
    }

    // Log authentication attempts
    if (req.url.includes('/auth/') || req.url.includes('/login')) {
      securityLogger.security('Authentication attempt', 'info', securityContext);
    }

    // Check for common attack vectors in headers
    const dangerousHeaders = [
      'x-forwarded-for',
      'x-real-ip',
      'x-originating-ip'
    ];

    dangerousHeaders.forEach(header => {
      const value = req.get(header);
      if (value && /[<>\"'&]/.test(value)) {
        securityLogger.security('Dangerous characters in header', 'warn', {
          ...securityContext,
          header,
          value
        });
      }
    });

    next();
  };
}

/**
 * Sanitizes incoming request data by removing dangerous characters and protocols.
 *
 * Recursively processes strings, arrays, and plain objects found in the request and
 * removes angle brackets, the `javascript:` and `data:` protocols, and surrounding whitespace
 * from string values. Applies changes in-place to `req.body`, `req.query`, and `req.params`.
 *
 * @returns {function} Express middleware that sanitizes `req.body`, `req.query`, and `req.params`.
 */
export function sanitizeInput() {
  return (req, res, next) => {
    /**
     * Recursively sanitize input by stripping angle brackets, `javascript:` and `data:` protocols, and trimming strings; applies the same sanitization to arrays and objects.
     * @param {*} value - Value to sanitize; may be a string, array, object, or other primitive.
     * @returns {*} The sanitized value with strings cleaned, arrays mapped, and object properties sanitized; other types are returned unchanged.
     */
    function sanitizeValue(value) {
      if (typeof value === 'string') {
        // Remove potentially dangerous characters
        return value
          .replace(/[<>]/g, '') // Remove angle brackets
          .replace(/javascript:/gi, '') // Remove javascript protocol
          .replace(/data:/gi, '') // Remove data protocol
          .trim();
      } else if (Array.isArray(value)) {
        return value.map(sanitizeValue);
      } else if (value && typeof value === 'object') {
        const sanitized = {};
        for (const [key, val] of Object.entries(value)) {
          sanitized[key] = sanitizeValue(val);
        }
        return sanitized;
      }
      return value;
    }

    // Sanitize request body
    if (req.body) {
      req.body = sanitizeValue(req.body);
    }

    // Sanitize query parameters
    if (req.query) {
      req.query = sanitizeValue(req.query);
    }

    // Sanitize URL parameters
    if (req.params) {
      req.params = sanitizeValue(req.params);
    }

    next();
  };
}

/**
 * Sets a strict Content-Security-Policy header on each response to restrict permitted sources.
 *
 * The policy restricts resources as follows: default to same-origin; scripts to same-origin;
 * styles to same-origin and allow inline styles; images to same-origin, data URIs, and HTTPS;
 * connections to same-origin and WebSocket (ws/wss); fonts to same-origin; objects and frames disallowed;
 * media to same-origin.
 *
 * @returns {import('express').RequestHandler} Express middleware that sets the Content-Security-Policy header.
 */
export function contentSecurityPolicy() {
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self' ws: wss:; " +
      "font-src 'self'; " +
      "object-src 'none'; " +
      "media-src 'self'; " +
      "frame-src 'none';"
    );
    next();
  };
}

/**
 * Create Express middleware that blocks or allows requests based on IP whitelist and blacklist.
 *
 * @param {Object} [options] - Configuration for IP filtering.
 * @param {string[]} [options.whitelist] - Array of allowed client IPs; when provided, only these IPs are permitted.
 * @param {string[]} [options.blacklist] - Array of denied client IPs; these IPs are blocked immediately.
 * @returns {function} An Express middleware function that responds with HTTP 403 for blocked or non-whitelisted IPs and calls `next()` for allowed requests.
 */
export function ipFilter(options = {}) {
  const { whitelist = [], blacklist = [] } = options;

  return (req, res, next) => {
    const clientIP = req.ip;

    // Check blacklist first
    if (blacklist.length > 0 && blacklist.includes(clientIP)) {
      logger.security('Blocked IP attempted access', 'warn', {
        ip: clientIP,
        url: req.url,
        userAgent: req.get('User-Agent')
      });

      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied',
        statusCode: 403,
        timestamp: new Date().toISOString()
      });
    }

    // Check whitelist if configured
    if (whitelist.length > 0 && !whitelist.includes(clientIP)) {
      logger.security('Non-whitelisted IP attempted access', 'warn', {
        ip: clientIP,
        url: req.url,
        userAgent: req.get('User-Agent')
      });

      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied',
        statusCode: 403,
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
}

/**
 * Create middleware that detects and mitigates high-rate requests (DDOS) per client IP.
 *
 * The middleware tracks requests per IP over a short time window and, if a single IP
 * exceeds a threshold (50 requests/second), marks that IP as suspicious and responds
 * with HTTP 429. Suspicious IPs receive HTTP 429 for subsequent requests until cleared.
 *
 * @returns {Function} An Express middleware function that monitors per-IP request rates and
 *                     responds with HTTP 429 when the rate exceeds 50 requests/second or when
 *                     the IP is temporarily blocked; otherwise calls `next()`.
 */
export function ddosProtection() {
  const connections = new Map();
  const suspiciousIPs = new Set();

  return (req, res, next) => {
    const clientIP = req.ip;
    const now = Date.now();

    // Clean old entries (older than 1 minute)
    for (const [ip, data] of connections.entries()) {
      if (now - data.firstRequest > 60000) {
        connections.delete(ip);
      }
    }

    // Track connection
    if (!connections.has(clientIP)) {
      connections.set(clientIP, {
        count: 1,
        firstRequest: now,
        lastRequest: now
      });
    } else {
      const data = connections.get(clientIP);
      data.count++;
      data.lastRequest = now;

      // Check for DDOS patterns
      const timeWindow = now - data.firstRequest;
      const requestRate = data.count / (timeWindow / 1000); // requests per second

      if (requestRate > 50) { // More than 50 requests per second
        suspiciousIPs.add(clientIP);

        logger.security('Potential DDOS attack detected', 'error', {
          ip: clientIP,
          requestCount: data.count,
          timeWindow,
          requestRate,
          url: req.url
        });

        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Request rate limit exceeded',
          statusCode: 429,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Block previously flagged suspicious IPs for a while
    if (suspiciousIPs.has(clientIP)) {
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'IP temporarily blocked',
        statusCode: 429,
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
}