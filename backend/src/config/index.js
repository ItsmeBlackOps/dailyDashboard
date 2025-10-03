import "dotenv/config";
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

if (!process.env.MONGODB_URI) {
  loadEnv({ path: resolve(process.cwd(), '..', '.env') });
}

if (process.env.MONGODB_URI) {
  process.env.MONGODB_URI = process.env.MONGODB_URI.replace(/^['"]|['"]$/g, '');
}

const stripQuotes = (value = '') => value.replace(/^['"]|['"]$/g, '').trim();

const commaSeparated = (value = '') =>
  value
    .split(',')
    .map((entry) => stripQuotes(entry))
    .filter(Boolean);

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

  logflare: (() => {
    const sourceId = stripQuotes(process.env.LOGFLARE_SOURCE_ID || 'a41467c3-6410-4f84-a1a2-c0bb8118e784');
    const apiKey = stripQuotes(process.env.LOGFLARE_API_KEY || 'kuvw1feGD8Yw');
    const endpoint = stripQuotes(process.env.LOGFLARE_ENDPOINT || 'https://api.logflare.app/logs');

    return {
      sourceId,
      apiKey,
      endpoint,
      enabled: Boolean(sourceId && apiKey)
    };
  })(),

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
  },

  azure: {
    tenantId: stripQuotes(process.env.AZURE_TENANT_ID || '4ece6d1e-592c-44f1-b187-6076e9180510'),
    clientId: stripQuotes(process.env.AZURE_CLIENT_ID || '4fc9e095-61df-4a55-9b0c-2419747b96d0'),
    clientSecret: stripQuotes(process.env.AZURE_CLIENT_SECRET || '_Ax8Q~YcwSTX6uA2h0qaHliuW_h6obhcsEPBxaUd'),
    redirectUri:
      stripQuotes(process.env.BACKEND_REDIRECT_URI || 'https://dailydb.silverspace.tech/auth/redirect'),
    meetingScopes: (() => {
      const raw = process.env.AZURE_GRAPH_MEETING_SCOPES;
      if (raw && raw.trim().length > 0) {
        return commaSeparated(raw);
      }
      return [
        'https://graph.microsoft.com/OnlineMeetings.ReadWrite',
        'https://graph.microsoft.com/Calendars.ReadWrite',
        'https://graph.microsoft.com/Mail.Send'
      ];
    })(),
    mailScopes: (() => {
      const raw = process.env.AZURE_GRAPH_MAIL_SCOPES;
      if (raw && raw.trim().length > 0) {
        return commaSeparated(raw);
      }
      return ['https://graph.microsoft.com/Mail.Send'];
    })(),
    mailSender: stripQuotes(process.env.AZURE_GRAPH_MAIL_SENDER || '')
  },

  support: (() => {
    const supportTo = stripQuotes(process.env.SUPPORT_REQUEST_TO || 'tech.leaders@silverspaceinc.com');
    const supportCcFallback = commaSeparated(process.env.SUPPORT_REQUEST_CC || '');
    const maxAttachmentBytesRaw = process.env.SUPPORT_ATTACHMENT_MAX_BYTES;
    const maxAttachmentBytes = maxAttachmentBytesRaw
      ? Number.parseInt(maxAttachmentBytesRaw, 10)
      : 5 * 1024 * 1024;

    return {
      supportTo,
      supportCcFallback,
      attachmentMaxBytes: Number.isFinite(maxAttachmentBytes) && maxAttachmentBytes > 0
        ? maxAttachmentBytes
        : 5 * 1024 * 1024
    };
  })()
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
