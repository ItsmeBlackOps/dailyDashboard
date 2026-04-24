/**
 * Environment Configuration Manager
 *
 * Centralized configuration management with validation, type conversion,
 * and environment-specific overrides.
 */

import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

// Load environment variables
dotenv.config();

/**
 * Configuration schema with validation and defaults
 */
const configSchema = {
  // Server Configuration
  server: {
    port: {
      env: 'PORT',
      type: 'number',
      default: 3004,
      validate: (value) => value > 0 && value < 65536
    },
    host: {
      env: 'HOST',
      type: 'string',
      default: '0.0.0.0'
    },
    subdomain: {
      env: 'SUBDOMAIN',
      type: 'string',
      default: 'dailydb'
    }
  },

  // Database Configuration
  database: {
    uri: {
      env: 'MONGODB_URI',
      type: 'string',
      required: true,
      validate: (value) => value.startsWith('mongodb')
    },
    options: {
      retryWrites: true,
      w: 'majority'
    }
  },

  // Security Configuration
  security: {
    jwtSecret: {
      env: 'JWT_SECRET',
      type: 'string',
      required: true,
      validate: (value) => value.length >= 32
    },
    jwtExpiry: {
      env: 'JWT_EXPIRY',
      type: 'string',
      default: '15m'
    },
    refreshTokenExpiry: {
      env: 'REFRESH_TOKEN_EXPIRY',
      type: 'string',
      default: '7d'
    },
    bcryptRounds: {
      env: 'BCRYPT_ROUNDS',
      type: 'number',
      default: 12,
      validate: (value) => value >= 10 && value <= 15
    }
  },

  // CORS Configuration
  cors: {
    origin: {
      env: 'CORS_ORIGIN',
      type: 'array',
      default: ['http://localhost:3000', 'http://localhost:8180', 'http://localhost:5173'],
      transform: (value) => typeof value === 'string' ? value.split(',') : value
    },
    credentials: {
      env: 'CORS_CREDENTIALS',
      type: 'boolean',
      default: true
    }
  },

  // Socket.IO Configuration
  socket: {
    cors: {
      origin: {
        env: 'SOCKET_CORS_ORIGIN',
        type: 'array',
        default: ['http://localhost:3000', 'http://localhost:8180'],
        transform: (value) => typeof value === 'string' ? value.split(',') : value
      },
      credentials: true
    },
    transports: ['websocket', 'polling'],
    pingTimeout: {
      env: 'SOCKET_PING_TIMEOUT',
      type: 'number',
      default: 60000
    },
    pingInterval: {
      env: 'SOCKET_PING_INTERVAL',
      type: 'number',
      default: 25000
    }
  },

  // Logging Configuration
  logging: {
    level: {
      env: 'LOG_LEVEL',
      type: 'string',
      default: 'info',
      validate: (value) => ['error', 'warn', 'info', 'debug', 'verbose'].includes(value)
    },
    format: {
      env: 'LOG_FORMAT',
      type: 'string',
      default: 'json',
      validate: (value) => ['json', 'simple', 'combined'].includes(value)
    }
  },

  // New Relic Configuration
  newRelic: {
    appName: {
      env: 'NEW_RELIC_APP_NAME',
      type: 'string',
      default: 'dailydb-backend'
    },
    licenseKey: {
      env: 'NEW_RELIC_LICENSE_KEY',
      type: 'string'
    },
    logLevel: {
      env: 'NEW_RELIC_LOG_LEVEL',
      type: 'string',
      default: 'info'
    },
    enabled: {
      env: 'NEW_RELIC_ENABLED',
      type: 'boolean',
      default: true
    }
  },

  // Rate Limiting Configuration
  rateLimit: {
    windowMs: {
      env: 'RATE_LIMIT_WINDOW_MS',
      type: 'number',
      default: 15 * 60 * 1000 // 15 minutes
    },
    maxRequests: {
      env: 'RATE_LIMIT_MAX_REQUESTS',
      type: 'number',
      default: 100
    },
    skipSuccessfulRequests: {
      env: 'RATE_LIMIT_SKIP_SUCCESSFUL',
      type: 'boolean',
      default: false
    }
  },

  // Application Configuration
  app: {
    name: {
      env: 'APP_NAME',
      type: 'string',
      default: 'Daily Dashboard API'
    },
    version: {
      env: 'APP_VERSION',
      type: 'string',
      default: '1.0.0'
    },
    environment: {
      env: 'NODE_ENV',
      type: 'string',
      default: 'development',
      validate: (value) => ['development', 'staging', 'production', 'test'].includes(value)
    }
  }
};

/**
 * Type conversion utilities
 */
const typeConverters = {
  string: (value) => String(value),
  number: (value) => {
    const num = Number(value);
    if (isNaN(num)) throw new Error(`Invalid number: ${value}`);
    return num;
  },
  boolean: (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      if (lower === 'true' || lower === '1') return true;
      if (lower === 'false' || lower === '0') return false;
    }
    throw new Error(`Invalid boolean: ${value}`);
  },
  array: (value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.split(',').map(s => s.trim());
    throw new Error(`Invalid array: ${value}`);
  }
};

/**
 * Build configuration from schema
 */
function buildConfig(schema, prefix = '') {
  const config = {};

  for (const [key, value] of Object.entries(schema)) {
    if (value.env || value.type || value.default !== undefined) {
      // This is a configuration value
      const envValue = value.env ? process.env[value.env] : undefined;
      let finalValue = envValue !== undefined ? envValue : value.default;

      // Check if required value is missing
      if (value.required && finalValue === undefined) {
        throw new Error(`Required configuration missing: ${prefix}${key} (${value.env})`);
      }

      // Type conversion
      if (finalValue !== undefined && value.type && typeConverters[value.type]) {
        try {
          finalValue = typeConverters[value.type](finalValue);
        } catch (error) {
          throw new Error(`Invalid ${value.type} for ${prefix}${key}: ${error.message}`);
        }
      }

      // Custom transformation
      if (finalValue !== undefined && value.transform) {
        finalValue = value.transform(finalValue);
      }

      // Validation
      if (finalValue !== undefined && value.validate && !value.validate(finalValue)) {
        throw new Error(`Validation failed for ${prefix}${key}: ${finalValue}`);
      }

      config[key] = finalValue;
    } else {
      // This is a nested configuration object
      config[key] = buildConfig(value, `${prefix}${key}.`);
    }
  }

  return config;
}

/**
 * Load and validate configuration
 */
let config;

try {
  config = buildConfig(configSchema);

  // Log configuration loading (without sensitive data)
  const safeConfig = JSON.parse(JSON.stringify(config));
  if (safeConfig.security?.jwtSecret) {
    safeConfig.security.jwtSecret = '[REDACTED]';
  }
  if (safeConfig.database?.uri) {
    safeConfig.database.uri = safeConfig.database.uri.replace(/:[^@]*@/, ':[REDACTED]@');
  }
  if (safeConfig.newRelic?.licenseKey) {
    safeConfig.newRelic.licenseKey = '[REDACTED]';
  }

  logger.info('Configuration loaded successfully', { config: safeConfig });

} catch (error) {
  logger.error('Configuration validation failed', { error: error.message });
  process.exit(1);
}

/**
 * Configuration getter with dot notation support
 */
export function getConfig(path) {
  if (!path) return config;

  return path.split('.').reduce((obj, key) => {
    return obj && obj[key] !== undefined ? obj[key] : undefined;
  }, config);
}

/**
 * Check if running in specific environment
 */
export function isProduction() {
  return config.app.environment === 'production';
}

export function isDevelopment() {
  return config.app.environment === 'development';
}

export function isTest() {
  return config.app.environment === 'test';
}

/**
 * Export full configuration object
 */
export { config };
export default config;