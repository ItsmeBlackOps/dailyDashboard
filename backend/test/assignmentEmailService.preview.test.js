// backend/test/assignmentEmailService.preview.test.js
import { describe, it, expect } from '@jest/globals';
import { buildAssignmentEmailPreview } from '../src/services/assignmentEmailService.js';

const args = {
  candidateName: 'Asha Rao', technology: 'Software Developer', visaType: 'H1B',
  recruiterEmail: 'rec@x.com', recruiterDisplayName: 'Rec X',
  teamLeadEmail: 'tl@x.com', teamLeadDisplayName: 'TL X',
  managerEmail: 'mgr@x.com', permanentCcEmail: 'tushar.ahuja@silverspaceinc.com',
  senderEmail: 'me@x.com', senderDisplayName: 'Me',
  attachments: [{ id: 'a1', filename: 'resume.pdf', mimeType: 'application/pdf' }], // NO bytes
  appendBody: 'Please prioritise.',
};

describe('buildAssignmentEmailPreview', () => {
  it('builds recipients/subject/body from metadata without bytes', () => {
    const p = buildAssignmentEmailPreview(args);
    expect(p.to).toEqual(['rec@x.com']);
    expect(p.cc).toEqual(expect.arrayContaining(['mgr@x.com', 'tl@x.com', 'tushar.ahuja@silverspaceinc.com']));
    expect(p.subject).toContain('Asha Rao');
    expect(p.bodyHtml).toContain('Please prioritise.');   // appendBody prepended
    expect(p.bodyHtml).toContain('Hi TL X,');
    expect(p.attachments).toEqual([{ id: 'a1', filename: 'resume.pdf' }]);
  });

  it('still sends correctly: buildAssignmentEmail unchanged for byte-carrying attachments', async () => {
    const { buildAssignmentEmail } = await import('../src/services/assignmentEmailService.js');
    const sent = buildAssignmentEmail({ ...args, attachments: [{ id: 'a1', filename: 'resume.pdf', mimeType: 'application/pdf', contentBytesBase64: 'AAAA' }] });
    expect(sent.message.attachments[0].contentBytes).toBe('AAAA');
    expect(sent._audit.to).toEqual(['rec@x.com']);
  });
});
