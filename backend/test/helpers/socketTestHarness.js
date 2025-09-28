import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { io } from 'socket.io-client';

if (!process.env.TEST_USER_EMAIL || !process.env.TEST_USER_PASSWORD) {
  loadEnv({ path: resolve(process.cwd(), '..', '.env') });
}

const TEST_CREDENTIALS = {
  email: process.env.TEST_USER_EMAIL,
  password: process.env.TEST_USER_PASSWORD
};

const TEST_JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const DEFAULT_DB_NAME = 'interviewSupport';

export async function setupSocketTestHarness() {
  if (!TEST_CREDENTIALS.email || !TEST_CREDENTIALS.password) {
    throw new Error('Socket tests require TEST_USER_EMAIL and TEST_USER_PASSWORD to be configured.');
  }
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI must be set in the environment to run integration tests');
  }

  const normalizedMongoUri = mongoUri.replace(/^['"]|['"]$/g, '');
  process.env.MONGODB_URI = normalizedMongoUri;

  process.env.NODE_ENV = 'test';
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';
  process.env.DB_NAME = process.env.DB_NAME || DEFAULT_DB_NAME;
  process.env.JWT_SECRET = process.env.JWT_SECRET || TEST_JWT_SECRET;

  const { Application } = await import('../../src/index.js');
  const { config } = await import('../../src/config/index.js');
  const { database } = await import('../../src/config/database.js');
  const { refreshTokenModel } = await import('../../src/models/RefreshToken.js');

  config.server.port = 0;
  config.server.host = '127.0.0.1';

  const app = new Application();
  await app.initialize();

  const server = app.getServer();
  const port = await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
    server.on('error', reject);
  });

  const client = io(`http://127.0.0.1:${port}`, {
    autoConnect: false,
    transports: ['websocket'],
    timeout: 10000
  });

  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
    client.connect();
  });

  const emitWithAck = (event, payload = undefined, timeoutMs = 10000) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timeout`)), timeoutMs);
    const ack = (response) => {
      clearTimeout(timer);
      resolve(response);
    };

    if (payload === undefined) {
      client.emit(event, ack);
    } else {
      client.emit(event, payload, ack);
    }
  });

  const shutdown = async () => {
    if (client.connected) {
      client.disconnect();
    }
    await app.getSocketManager()?.gracefulShutdown();
    refreshTokenModel.stopCleanupJob();
    await database.disconnect();
    await app.stop();
  };

  return {
    app,
    client,
    database,
    refreshTokenModel,
    emitWithAck,
    shutdown,
    port,
    credentials: TEST_CREDENTIALS
  };
}

export const SOCKET_TEST_CONFIG = {
  credentials: TEST_CREDENTIALS,
  jwtSecret: process.env.JWT_SECRET || TEST_JWT_SECRET
};
