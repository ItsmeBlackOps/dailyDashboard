import { describe, it, expect, beforeEach, jest } from '@jest/globals';

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
