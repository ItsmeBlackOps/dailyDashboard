import { describe, it, expect, beforeEach, jest } from '@jest/globals';

process.env.SUPABASE_S3_BUCKET = process.env.SUPABASE_S3_BUCKET || 'test-bucket';
process.env.SUPABASE_S3_ENDPOINT = process.env.SUPABASE_S3_ENDPOINT || 'https://test.supabase.co/storage/v1/s3';
process.env.SUPABASE_S3_ACCESS_KEY_ID = process.env.SUPABASE_S3_ACCESS_KEY_ID || 'test-access-key';
process.env.SUPABASE_S3_SECRET_ACCESS_KEY = process.env.SUPABASE_S3_SECRET_ACCESS_KEY || 'test-secret-key';
process.env.SUPABASE_PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'testprojectref';

const sendMock = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: sendMock })),
  PutObjectCommand: jest.fn((input) => input)
}));

const { storageService } = await import('../src/services/storageService.js');
const { config } = await import('../src/config/index.js');

describe('storageService.uploadResume', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  it('uploads resume and returns public URL from storage', async () => {
    const buffer = Buffer.from('%PDF-1.4');

    const result = await storageService.uploadResume({
      buffer,
      contentType: 'application/pdf',
      originalName: 'Candidate Resume.pdf',
      uploadedBy: 'manager@example.com'
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const commandArgs = sendMock.mock.calls[0][0];
    expect(commandArgs.Bucket).toBe(config.storage.bucket);
    expect(commandArgs.ContentType).toBe('application/pdf');
    expect(result.objectKey).toContain('resumes/');
    expect(result.resumeLink).toMatch(new RegExp(`^${config.storage.publicUrl}/${config.storage.bucket}/`));
  });
});
