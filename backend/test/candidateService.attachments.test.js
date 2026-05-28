import { describe, it, expect, jest, afterEach, beforeEach } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { candidateModel } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';
import { userService } from '../src/services/userService.js';
import { storageService } from '../src/services/storageService.js';

const originalGetCandidateById = candidateModel.getCandidateById;
const originalUpdateCandidateById = candidateModel.updateCandidateById;
const originalGetUserByEmail = userModel.getUserByEmail;
const originalGetAllUsers = userModel.getAllUsers;
const originalCollectManageableUsers = userService.collectManageableUsers;
const originalUploadAttachment = storageService.uploadAttachment;
const originalDeleteObject = storageService.deleteObject;
const originalStreamObject = storageService.streamObject;

afterEach(() => {
  candidateModel.getCandidateById = originalGetCandidateById;
  candidateModel.updateCandidateById = originalUpdateCandidateById;
  userModel.getUserByEmail = originalGetUserByEmail;
  userModel.getAllUsers = originalGetAllUsers;
  userService.collectManageableUsers = originalCollectManageableUsers;
  storageService.uploadAttachment = originalUploadAttachment;
  storageService.deleteObject = originalDeleteObject;
  storageService.streamObject = originalStreamObject;
  jest.restoreAllMocks();
});

// Set up a candidate + an in-scope recruiter so attachment ops succeed
// for permitted roles by default. Individual tests override as needed.
const setupInScope = (candidateOverrides = {}) => {
  const candidate = {
    _id: 'cand1',
    'Candidate Name': 'Jane Doe',
    Recruiter: 'rec.one@company.com',
    recruiter: 'rec.one@company.com',
    attachments: [],
    ...candidateOverrides
  };
  candidateModel.getCandidateById = jest.fn().mockResolvedValue(candidate);
  candidateModel.updateCandidateById = jest.fn().mockResolvedValue({ ...candidate });
  userService.collectManageableUsers = jest.fn().mockReturnValue([
    { email: 'rec.one@company.com', role: 'recruiter', active: true }
  ]);
  userModel.getUserByEmail = jest.fn((email) => {
    if ((email || '').toLowerCase() === 'rec.one@company.com') {
      return { email: 'rec.one@company.com', role: 'recruiter', active: true };
    }
    return null;
  });
  return candidate;
};

describe('candidateService.addAttachment', () => {
  beforeEach(() => {
    storageService.uploadAttachment = jest.fn().mockResolvedValue({
      objectKey: 'attachments/cand1/2026/05/28/abc.pdf',
      url: 'https://cdn.example.com/bucket/attachments/cand1/2026/05/28/abc.pdf',
      size: 1234,
      contentType: 'application/pdf'
    });
  });

  it('uploads + pushes the attachment for an in-scope recruiter', async () => {
    setupInScope();
    const result = await candidateService.addAttachment(
      { email: 'rec.one@company.com', role: 'recruiter' },
      'cand1',
      { buffer: Buffer.from('pdf'), mimetype: 'application/pdf', originalname: 'resume.pdf' }
    );
    expect(result).toMatchObject({
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
      size: 1234,
      s3Key: 'attachments/cand1/2026/05/28/abc.pdf',
      url: 'https://cdn.example.com/bucket/attachments/cand1/2026/05/28/abc.pdf',
      uploadedBy: 'rec.one@company.com'
    });
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(storageService.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith(
      'cand1',
      expect.objectContaining({
        _pushAttachment: expect.objectContaining({ id: result.id, s3Key: result.s3Key }),
        _changedBy: 'rec.one@company.com',
        _source: 'attachment-upload'
      })
    );
  });

  it('rejects technical roles (lead / am / expert / user) with 403', async () => {
    setupInScope();
    for (const role of ['lead', 'am', 'expert', 'user']) {
      await expect(
        candidateService.addAttachment(
          { email: `${role}@company.com`, role },
          'cand1',
          { buffer: Buffer.from('pdf'), mimetype: 'application/pdf', originalname: 'r.pdf' }
        )
      ).rejects.toMatchObject({ statusCode: 403 });
    }
    expect(storageService.uploadAttachment).not.toHaveBeenCalled();
  });

  it('rejects an out-of-scope recruiter with 403', async () => {
    setupInScope({ Recruiter: 'rec.other@company.com', recruiter: 'rec.other@company.com' });
    // The acting recruiter does NOT manage rec.other.
    userService.collectManageableUsers = jest.fn().mockReturnValue([]);
    await expect(
      candidateService.addAttachment(
        { email: 'rec.one@company.com', role: 'recruiter' },
        'cand1',
        { buffer: Buffer.from('pdf'), mimetype: 'application/pdf', originalname: 'r.pdf' }
      )
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(storageService.uploadAttachment).not.toHaveBeenCalled();
  });

  it('returns 404 when the candidate does not exist', async () => {
    candidateModel.getCandidateById = jest.fn().mockResolvedValue(null);
    await expect(
      candidateService.addAttachment(
        { email: 'mm.user@company.com', role: 'mm' },
        'missing',
        { buffer: Buffer.from('pdf'), mimetype: 'application/pdf', originalname: 'r.pdf' }
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 400 when the file payload is missing or empty', async () => {
    setupInScope();
    await expect(
      candidateService.addAttachment(
        { email: 'mm.user@company.com', role: 'mm' },
        'cand1',
        null
      )
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      candidateService.addAttachment(
        { email: 'mm.user@company.com', role: 'mm' },
        'cand1',
        { mimetype: 'application/pdf', originalname: 'r.pdf' } // no buffer
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('bubbles up storage MIME / size errors as the same statusCode', async () => {
    setupInScope();
    storageService.uploadAttachment = jest.fn().mockRejectedValue(
      Object.assign(new Error('Unsupported attachment type. Allowed: pdf, docx, xlsx, png, jpeg'), { statusCode: undefined })
    );
    await expect(
      candidateService.addAttachment(
        { email: 'mm.user@company.com', role: 'mm' },
        'cand1',
        { buffer: Buffer.from('x'), mimetype: 'application/x-evil', originalname: 'evil.exe' }
      )
    ).rejects.toThrow(/Unsupported attachment type/);
    expect(candidateModel.updateCandidateById).not.toHaveBeenCalled();
  });
});

describe('candidateService.removeAttachment', () => {
  beforeEach(() => {
    storageService.deleteObject = jest.fn().mockResolvedValue(undefined);
  });

  it('pulls the attachment and triggers a best-effort storage delete', async () => {
    setupInScope({
      attachments: [{
        id: 'att-1',
        filename: 'r.pdf',
        s3Key: 'attachments/cand1/x.pdf',
        url: 'https://cdn.example.com/x.pdf',
        mimeType: 'application/pdf',
        size: 100
      }]
    });
    const result = await candidateService.removeAttachment(
      { email: 'rec.one@company.com', role: 'recruiter' },
      'cand1',
      'att-1'
    );
    expect(result).toEqual({ id: 'att-1', removed: true });
    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith(
      'cand1',
      expect.objectContaining({
        _pullAttachmentId: 'att-1',
        _changedBy: 'rec.one@company.com',
        _source: 'attachment-delete'
      })
    );
    expect(storageService.deleteObject).toHaveBeenCalledWith('attachments/cand1/x.pdf');
  });

  it('clears resumeLink when removing the attachment that was the canonical resume', async () => {
    setupInScope({
      resumeLink: 'https://cdn.example.com/x.pdf',
      attachments: [{
        id: 'att-1',
        url: 'https://cdn.example.com/x.pdf',
        s3Key: 'attachments/cand1/x.pdf',
        mimeType: 'application/pdf'
      }]
    });
    await candidateService.removeAttachment(
      { email: 'rec.one@company.com', role: 'recruiter' },
      'cand1',
      'att-1'
    );
    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith(
      'cand1',
      expect.objectContaining({ resumeLink: '' })
    );
  });

  it('does NOT clear resumeLink when removing a different attachment', async () => {
    setupInScope({
      resumeLink: 'https://cdn.example.com/canonical.pdf',
      attachments: [
        { id: 'att-keep', url: 'https://cdn.example.com/canonical.pdf', s3Key: 'k.pdf', mimeType: 'application/pdf' },
        { id: 'att-2', url: 'https://cdn.example.com/y.pdf', s3Key: 'y.pdf', mimeType: 'application/pdf' }
      ]
    });
    await candidateService.removeAttachment(
      { email: 'rec.one@company.com', role: 'recruiter' },
      'cand1',
      'att-2'
    );
    const callArg = candidateModel.updateCandidateById.mock.calls[0][1];
    expect(callArg.resumeLink).toBeUndefined();
  });

  it('returns 404 for an unknown attachmentId', async () => {
    setupInScope({ attachments: [{ id: 'att-other' }] });
    await expect(
      candidateService.removeAttachment(
        { email: 'mm.user@company.com', role: 'mm' },
        'cand1',
        'att-missing'
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('swallows storage-delete errors so the DB stays consistent', async () => {
    setupInScope({
      attachments: [{ id: 'att-1', s3Key: 'attachments/cand1/x.pdf' }]
    });
    storageService.deleteObject = jest.fn().mockRejectedValue(new Error('S3 timeout'));
    const result = await candidateService.removeAttachment(
      { email: 'mm.user@company.com', role: 'mm' },
      'cand1',
      'att-1'
    );
    expect(result).toEqual({ id: 'att-1', removed: true });
    expect(candidateModel.updateCandidateById).toHaveBeenCalled();
  });
});

describe('candidateService.setAttachmentAsResume', () => {
  it('updates resumeLink to the chosen PDF attachment URL', async () => {
    setupInScope({
      attachments: [{
        id: 'att-1',
        url: 'https://cdn.example.com/r.pdf',
        s3Key: 'attachments/cand1/r.pdf',
        mimeType: 'application/pdf'
      }]
    });
    const result = await candidateService.setAttachmentAsResume(
      { email: 'mm.user@company.com', role: 'mm' },
      'cand1',
      'att-1'
    );
    expect(result).toEqual({ id: 'att-1', resumeLink: 'https://cdn.example.com/r.pdf' });
    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith(
      'cand1',
      expect.objectContaining({
        resumeLink: 'https://cdn.example.com/r.pdf',
        _source: 'attachment-set-resume'
      })
    );
  });

  it('refuses to promote a non-PDF attachment with 400', async () => {
    setupInScope({
      attachments: [{
        id: 'att-img',
        url: 'https://cdn.example.com/photo.png',
        mimeType: 'image/png'
      }]
    });
    await expect(
      candidateService.setAttachmentAsResume(
        { email: 'mm.user@company.com', role: 'mm' },
        'cand1',
        'att-img'
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns 404 for an unknown attachmentId', async () => {
    setupInScope({ attachments: [] });
    await expect(
      candidateService.setAttachmentAsResume(
        { email: 'mm.user@company.com', role: 'mm' },
        'cand1',
        'nope'
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('candidateService.resolveAttachmentForDownload', () => {
  it('returns the attachment after permission + scope checks pass', async () => {
    setupInScope({
      attachments: [{ id: 'att-1', filename: 'r.pdf', s3Key: 'attachments/cand1/r.pdf' }]
    });
    const att = await candidateService.resolveAttachmentForDownload(
      { email: 'rec.one@company.com', role: 'recruiter' },
      'cand1',
      'att-1'
    );
    expect(att).toMatchObject({ id: 'att-1', s3Key: 'attachments/cand1/r.pdf' });
  });

  it('rejects out-of-scope readers with 403', async () => {
    setupInScope({
      attachments: [{ id: 'att-1' }],
      Recruiter: 'rec.other@company.com',
      recruiter: 'rec.other@company.com'
    });
    userService.collectManageableUsers = jest.fn().mockReturnValue([]);
    await expect(
      candidateService.resolveAttachmentForDownload(
        { email: 'rec.one@company.com', role: 'recruiter' },
        'cand1',
        'att-1'
      )
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects technical-track roles with 403', async () => {
    setupInScope({ attachments: [{ id: 'att-1' }] });
    for (const role of ['lead', 'am', 'expert', 'user']) {
      await expect(
        candidateService.resolveAttachmentForDownload(
          { email: `${role}@company.com`, role },
          'cand1',
          'att-1'
        )
      ).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('returns 404 for an unknown attachmentId', async () => {
    setupInScope({ attachments: [] });
    await expect(
      candidateService.resolveAttachmentForDownload(
        { email: 'mm.user@company.com', role: 'mm' },
        'cand1',
        'nope'
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
