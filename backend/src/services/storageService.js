import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand
} from '@aws-sdk/client-s3';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const storageConfig = config.storage || {};

// PRT Phase 2: attachment MIME whitelist + canonical extensions.
// Keep in lockstep with PRT_ATTACHMENT_MIME_VALUES in the frontend.
export const ATTACHMENT_MIME_MAP = new Map([
  ['application/pdf', '.pdf'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['image/png', '.png'],
  ['image/jpeg', '.jpg']
]);
export const ATTACHMENT_MAX_BYTES_DEFAULT = 10 * 1024 * 1024;

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

function extensionForAttachment(contentType, originalName) {
  const mapped = ATTACHMENT_MIME_MAP.get((contentType || '').toLowerCase());
  if (mapped) return mapped;
  const fromName = extname(originalName || '').toLowerCase();
  return fromName || '';
}

function buildAttachmentKey({ candidateId, originalName, contentType }) {
  const ext = extensionForAttachment(contentType, originalName);
  const now = new Date();
  const datePrefix = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}`;
  const candidatePart = candidateId ? `${candidateId}/` : '';
  return `attachments/${candidatePart}${datePrefix}/${randomUUID()}${ext}`;
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
  },

  // PRT Phase 2: generic candidate attachment upload (PDF/DOCX/XLSX/PNG/JPEG,
  // ≤10 MB by default). Keys are namespaced under attachments/<candidateId>/
  // so a candidate-scoped lifecycle policy can later target them.
  async uploadAttachment({ buffer, contentType, originalName, uploadedBy, candidateId }) {
    if (!buffer || !(buffer instanceof Buffer)) {
      throw new Error('Attachment buffer is required');
    }

    const normalizedType = (contentType || '').toLowerCase();
    if (!ATTACHMENT_MIME_MAP.has(normalizedType)) {
      throw new Error(
        'Unsupported attachment type. Allowed: pdf, docx, xlsx, png, jpeg'
      );
    }

    const maxBytes = storageConfig.maxAttachmentBytes || ATTACHMENT_MAX_BYTES_DEFAULT;
    if (buffer.length > maxBytes) {
      throw new Error(
        `Attachment exceeds maximum size of ${Math.floor(maxBytes / (1024 * 1024))}MB`
      );
    }

    const bucket = storageConfig.bucket;
    if (!bucket) {
      throw new Error('Storage bucket not configured');
    }

    const objectKey = buildAttachmentKey({
      candidateId,
      originalName,
      contentType: normalizedType
    });

    const clientInstance = getClient();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: normalizedType,
      Metadata: originalName ? { 'original-name': originalName } : undefined
    });

    try {
      await clientInstance.send(command);
      const url = buildPublicUrl(objectKey);

      logger.info('Attachment uploaded to storage', {
        bucket,
        objectKey,
        uploadedBy,
        candidateId,
        size: buffer.length
      });

      return {
        objectKey,
        url,
        size: buffer.length,
        contentType: normalizedType
      };
    } catch (error) {
      logger.error('Attachment upload failed', {
        error: error.message,
        bucket,
        uploadedBy,
        candidateId
      });
      throw new Error('Unable to upload attachment');
    }
  },

  // Idempotent: missing or already-deleted keys are not treated as errors
  // beyond the S3 client's own behaviour (DeleteObject returns success
  // even when the key is absent).
  async deleteObject(objectKey) {
    if (!objectKey) return;
    const bucket = storageConfig.bucket;
    if (!bucket) {
      throw new Error('Storage bucket not configured');
    }

    const clientInstance = getClient();
    try {
      await clientInstance.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })
      );
      logger.info('Object deleted from storage', { bucket, objectKey });
    } catch (error) {
      logger.error('Object delete failed', {
        error: error.message,
        bucket,
        objectKey
      });
      throw new Error('Unable to delete attachment');
    }
  },

  // For Phase 3 (assignment email): pull a stored object into memory as
  // base64 so it can be embedded as a Graph #fileAttachment payload.
  async fetchObjectAsBase64(objectKey) {
    if (!objectKey) throw new Error('objectKey is required');
    const bucket = storageConfig.bucket;
    if (!bucket) {
      throw new Error('Storage bucket not configured');
    }
    const clientInstance = getClient();
    const response = await clientInstance.send(
      new GetObjectCommand({ Bucket: bucket, Key: objectKey })
    );
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    return {
      base64: buffer.toString('base64'),
      contentType: response.ContentType || 'application/octet-stream',
      contentLength: buffer.length
    };
  },

  // For Phase 2 (download proxy): return the live S3 stream + metadata so
  // the controller can pipe straight to the client without buffering the
  // whole file in memory.
  async streamObject(objectKey) {
    if (!objectKey) throw new Error('objectKey is required');
    const bucket = storageConfig.bucket;
    if (!bucket) {
      throw new Error('Storage bucket not configured');
    }
    const clientInstance = getClient();
    const response = await clientInstance.send(
      new GetObjectCommand({ Bucket: bucket, Key: objectKey })
    );
    return {
      stream: response.Body,
      contentType: response.ContentType || 'application/octet-stream',
      contentLength: response.ContentLength || null
    };
  }
};
