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
    origin: (origin, callback) => {
      const allowed = [
        process.env.FRONTEND_ORIGIN,
        'http://localhost:5173',
        'http://localhost:3000',
        'http://localhost:8180',
      ].filter(Boolean);
      if (!origin || allowed.includes(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
    exposedHeaders: ['X-Response-Time-Ms']
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
    model: process.env.OPENAI_REPORTING_MODEL || 'gpt-4o',
    timeoutMs: Number.parseInt(process.env.OPENAI_TIMEOUT_MS || '300000', 10),
    reasoningEffort: stripQuotes(process.env.OPENAI_REASONING_EFFORT || ''),
    // Feature flag: when true, only candidateProfileService may use OpenAI
    profileOnlyMode: process.env.OPENAI_PROFILE_ONLY_MODE !== 'false', // default true
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
    clientId: stripQuotes(process.env.AZURE_CLIENT_ID || process.env.AZURE_BACKEND_CLIENT_ID || '4fc9e095-61df-4a55-9b0c-2419747b96d0'),
    clientSecret: stripQuotes(process.env.AZURE_CLIENT_SECRET || process.env.AZURE_BACKEND_CLIENT_SECRET || ''),
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
      return [
        'https://graph.microsoft.com/Mail.Send',
        'https://graph.microsoft.com/Mail.ReadWrite',
      ];
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
  })(),

  storage: (() => {
    const projectRef = stripQuotes(process.env.SUPABASE_PROJECT_REF || '');
    const bucket = stripQuotes(process.env.SUPABASE_S3_BUCKET || '');
    const region = stripQuotes(process.env.SUPABASE_PROJECT_REGION || 'us-east-1');
    const endpoint = stripQuotes(process.env.SUPABASE_S3_ENDPOINT || '');
    const accessKeyId = stripQuotes(process.env.SUPABASE_S3_ACCESS_KEY_ID || '');
    const secretAccessKey = stripQuotes(process.env.SUPABASE_S3_SECRET_ACCESS_KEY || '');
    const maxResumeBytesRaw = process.env.CANDIDATE_RESUME_MAX_BYTES;
    const maxResumeBytes = maxResumeBytesRaw
      ? Number.parseInt(maxResumeBytesRaw, 10)
      : 5 * 1024 * 1024;

    const publicUrl = projectRef
      ? `https://${projectRef}.supabase.co/storage/v1/object/public`
      : '';

    return {
      projectRef,
      bucket,
      region: region || 'us-east-1',
      endpoint,
      accessKeyId,
      secretAccessKey,
      publicUrl,
      maxResumeBytes: Number.isFinite(maxResumeBytes) && maxResumeBytes > 0
        ? maxResumeBytes
        : 5 * 1024 * 1024
    };
  })(),

  fireflies: {
    apiKey: process.env.FIREFLIES_API_KEY || '',
    graphqlUrl: process.env.FIREFLIES_URL || 'https://api.fireflies.ai/graphql',
  },

  appwrite: {
    endpoint: process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1',
    projectId: process.env.APPWRITE_PROJECT_ID,
    apiKey: process.env.APPWRITE_API_KEY,
    databaseId: process.env.APPWRITE_DATABASE_ID,
    transcriptsCollectionId: process.env.APPWRITE_COLLECTION_ID_TRANSCRIPTS,
    generatedContentCollectionId: process.env.APPWRITE_COLLECTION_ID_GENERATED_CONTENT,
    interviewDebriefCollectionId: process.env.APPWRITE_COLLECTION_ID_INTERVIEW_DEBRIEF
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
