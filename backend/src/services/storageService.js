import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const storageConfig = config.storage || {};

let client = null;

function getClient() {
  if (client) {
    return client;
  }

  if (
    !storageConfig.endpoint ||
    !storageConfig.bucket ||
    !storageConfig.accessKeyId ||
    !storageConfig.secretAccessKey
  ) {
    throw new Error('Storage configuration is incomplete');
  }

  client = new S3Client({
    region: storageConfig.region || 'us-east-1',
    endpoint: storageConfig.endpoint,
    credentials: {
      accessKeyId: storageConfig.accessKeyId,
      secretAccessKey: storageConfig.secretAccessKey
    },
    forcePathStyle: true
  });

  return client;
}

function buildObjectKey(originalName = '') {
  const extension = extname(originalName).toLowerCase() === '.pdf' ? '.pdf' : '.pdf';
  const now = new Date();
  const datePrefix = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}`;
  return `resumes/${datePrefix}/${randomUUID()}${extension}`;
}

function buildPublicUrl(objectKey) {
  if (!storageConfig.publicUrl) {
    throw new Error('Public storage URL not configured');
  }
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
  return `${storageConfig.publicUrl}/${storageConfig.bucket}/${encodedKey}`;
}

export const storageService = {
  async uploadResume({ buffer, contentType, originalName, uploadedBy }) {
    if (!buffer || !(buffer instanceof Buffer)) {
      throw new Error('Resume buffer is required');
    }

    const normalizedType = (contentType || '').toLowerCase();
    if (normalizedType !== 'application/pdf') {
      throw new Error('Resume must be a PDF file');
    }

    const maxBytes = storageConfig.maxResumeBytes || 5 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new Error(`Resume exceeds maximum size of ${Math.floor(maxBytes / (1024 * 1024))}MB`);
    }

    const bucket = storageConfig.bucket;
    if (!bucket) {
      throw new Error('Storage bucket not configured');
    }

    const objectKey = buildObjectKey(originalName);

    const clientInstance = getClient();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: normalizedType
    });

    try {
      await clientInstance.send(command);
      const resumeLink = buildPublicUrl(objectKey);

      logger.info('Resume uploaded to storage', {
        bucket,
        objectKey,
        uploadedBy
      });

      return {
        objectKey,
        resumeLink
      };
    } catch (error) {
      logger.error('Resume upload failed', {
        error: error.message,
        bucket,
        uploadedBy
      });
      throw new Error('Unable to upload resume');
    }
  }
};
