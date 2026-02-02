
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import resourcesPkg from '@opentelemetry/resources';
const { resourceFromAttributes } = resourcesPkg;
import { logs } from '@opentelemetry/api-logs';

const POSTHOG_API_KEY = process.env.VITE_PUBLIC_POSTHOG_KEY;
console.log('DEBUG: posthogLogger.js evaluated. Key present:', !!POSTHOG_API_KEY);

// Only initialize if key is present to avoid errors in dev/CI if missing
if (POSTHOG_API_KEY) {
    const sdk = new NodeSDK({
        resource: resourceFromAttributes({
            'service.name': 'dailydb-backend',
        }),
        logRecordProcessor: new BatchLogRecordProcessor(
            new OTLPLogExporter({
                url: 'https://us.i.posthog.com/i/v1/logs',
                headers: {
                    'Authorization': `Bearer ${POSTHOG_API_KEY}`
                }
            })
        )
    });

    sdk.start();
    console.log('OpenTelemetry SDK started for PostHog');
} else {
    console.warn('PostHog API Key not found, OpenTelemetry logging disabled.');
}

// Get the logger instance
export const posthogLogger = logs.getLogger('dailydb-backend');

// Helper to log with standard levels, matching typical Winston style usage
export const logger = {
    info: (message, meta = {}) => {
        console.log(`[INFO] ${message}`, meta);
        posthogLogger.emit({
            severityText: 'INFO',
            body: message,
            attributes: { ...meta, level: 'info' }
        });
    },
    warn: (message, meta = {}) => {
        console.warn(`[WARN] ${message}`, meta);
        posthogLogger.emit({
            severityText: 'WARN',
            body: message,
            attributes: { ...meta, level: 'warn' }
        });
    },
    error: (message, meta = {}) => {
        console.error(`[ERROR] ${message}`, meta);
        posthogLogger.emit({
            severityText: 'ERROR',
            body: message instanceof Error ? message.message : message,
            attributes: {
                ...meta,
                level: 'error',
                stack: message instanceof Error ? message.stack : undefined
            }
        });
    },
    debug: (message, meta = {}) => {
        // Debug logs might be too verbose for PostHog, conditionally send?
        // For now, only console log debugs, or maybe implement LOG_LEVEL check.
        if (process.env.LOG_LEVEL === 'debug') {
            console.debug(`[DEBUG] ${message}`, meta);
            // posthogLogger.emit({ severityText: 'DEBUG', body: message, attributes: meta });
        }
    }
};
