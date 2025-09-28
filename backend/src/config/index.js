import "dotenv/config";
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

if (!process.env.MONGODB_URI) {
  loadEnv({ path: resolve(process.cwd(), '..', '.env') });
}

if (process.env.MONGODB_URI) {
  process.env.MONGODB_URI = process.env.MONGODB_URI.replace(/^['"]|['"]$/g, '');
}

const config = {
  server: {
    port: process.env.PORT || 3004,
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development'
  },

  database: {
    uri: process.env.MONGODB_URI,
    dbName: process.env.DB_NAME || 'interviewSupport',
    options: {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    }
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET,
    accessTokenExpiry: process.env.ACCESS_TOKEN_EXPIRY || '15m',
    refreshTokenExpiry: process.env.REFRESH_TOKEN_EXPIRY || '7d',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12
  },

  cors: {
    origin: process.env.FRONTEND_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
  },

  socket: {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'combined'
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL || process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_REPORTING_MODEL || 'gpt-5',
    timeoutMs: Number.parseInt(process.env.OPENAI_TIMEOUT_MS || '20000', 10)
  },

  newRelic: {
    enabled: process.env.NEW_RELIC_LICENSE_KEY ? true : false,
    appName:
      process.env.NEW_RELIC_BACKEND_APP_NAME ||
      process.env.NEW_RELIC_APP_NAME ||
      'dailydb-backend',
    logLevel: process.env.NEW_RELIC_LOG_LEVEL || 'info'
  }
};

// Validate required configuration
const validateConfig = () => {
  const required = [
    'database.uri',
    'auth.jwtSecret'
  ];

  const missing = required.filter(key => {
    const value = key.split('.').reduce((obj, prop) => obj?.[prop], config);
    return !value;
  });

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
};

export { config, validateConfig };
