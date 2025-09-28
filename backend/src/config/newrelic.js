import { config } from './index.js';
import { logger } from '../utils/logger.js';

export const initializeNewRelic = () => {
  if (!config.newRelic.enabled) {
    logger.info('📊 New Relic monitoring disabled (no license key)');
    return false;
  }

  try {
    // Set required environment variables for New Relic
    process.env.NEW_RELIC_APP_NAME = process.env.NEW_RELIC_APP_NAME || config.newRelic.appName;
    process.env.NEW_RELIC_LOG_LEVEL = process.env.NEW_RELIC_LOG_LEVEL || config.newRelic.logLevel;
    process.env.NEW_RELIC_NO_CONFIG_FILE = process.env.NEW_RELIC_NO_CONFIG_FILE || 'true';

    // Import New Relic (this should be done before other imports in production)
    // For now, we'll just set it up for when New Relic is loaded at startup
    logger.info('📊 New Relic monitoring configured', {
      appName: config.newRelic.appName,
      logLevel: config.newRelic.logLevel,
      distributedTracing: process.env.NEW_RELIC_DISTRIBUTED_TRACING_ENABLED,
      applicationLogging: process.env.NEW_RELIC_APPLICATION_LOGGING_ENABLED
    });

    return true;
  } catch (error) {
    logger.error('❌ Failed to initialize New Relic', { error: error.message });
    return false;
  }
};