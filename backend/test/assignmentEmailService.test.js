import { describe, it, expect } from '@jest/globals';
import { buildAssignmentEmail } from '../src/services/assignmentEmailService.js';

const baseArgs = () => ({
  candidateName: 'Jane Doe',
  technology: 'Software Developer',
  visaType: 'OPT',
  recruiterEmail: 'recruit.one@silverspaceinc.com',
  recruiterDisplayName: 'Recruit One',
  teamLeadEmail: 'lead.one@silverspaceinc.com',
  teamLeadDisplayName: 'Lead One',
  managerEmail: 'tushar.ahuja@silverspaceinc.com',
  permanentCcEmail: 'Tushar.ahuja@silverspaceinc.com',
  senderEmail: 'sender@silverspaceinc.com',
  senderDisplayName: 'Sender One',
  attachments: [{
    id: 'a1',
    filename: 'resume.pdf',
    mimeType: 'application/pdf',
    contentBytesBase64: 'aGVsbG8='
  }],
  appendBody: ''
});

describe('buildAssignmentEmail — template + tokens', () => {
  it('replaces the three body tokens verbatim', () => {
    const out = buildAssignmentEmail(baseArgs());
    const html = out.message.body.content;
    expect(html).toContain('Hi Lead One,');
    expect(html).toContain('Kindly assign this candidate profile to Recruit One and initiate the marketing within 24 hours.');
    expect(html).toContain('Best Regards,');
    expect(html).toMatch(/Sender One<\/p>$/);
  });

  it('contains the full PRD §6.2 body — compliance + documents bullets + both notes', () => {
    const out = buildAssignmentEmail(baseArgs());
    const html = out.message.body.content;
    for (const phrase of [
      "Candidate&#39;s location preference",
      'Salary expectations',
      'Visa status',
      'EAD start date and end date',
      'A brief summary of what was discussed during the intro call',
      'References, if the candidate has a client on the resume',
      'Credentials for marketing',
      'Note 1: Please check with the candidate for actual experience',
      'Note 2: Once I receive your response, I will send an acknowledgment email'
    ]) {
      expect(html).toContain(phrase);
    }
  });

  it('produces the Subject in `Assignment: <name> – <tech> – <visa>` form', () => {
    const out = buildAssignmentEmail(baseArgs());
    expect(out.message.subject).toBe('Assignment: Jane Doe – Software Developer – OPT');
  });

  it('falls back to em-dash placeholders when technology / visa are missing', () => {
    const out = buildAssignmentEmail({ ...baseArgs(), technology: '', visaType: '' });
    expect(out.message.subject).toBe('Assignment: Jane Doe – — – —');
  });

  it('prepends user-typed appendBody above the template, separated by <hr/>', () => {
    const out = buildAssignmentEmail({ ...baseArgs(), appendBody: 'Quick note for the team.' });
    const html = out.message.body.content;
    const prependIdx = html.indexOf('Quick note for the team.');
    const hrIdx = html.indexOf('<hr/>');
    const templateIdx = html.indexOf('Hi Lead One,');
    expect(prependIdx).toBeGreaterThan(-1);
    expect(hrIdx).toBeGreaterThan(prependIdx);
    expect(templateIdx).toBeGreaterThan(hrIdx);
  });

  it('escapes HTML in the appendBody', () => {
    const out = buildAssignmentEmail({ ...baseArgs(), appendBody: '<script>alert(1)</script>' });
    const html = out.message.body.content;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

describe('buildAssignmentEmail — recipients + permanent CC injection', () => {
  it('To is the recruiter email; CC includes manager + teamLead + permanentCc', () => {
    const out = buildAssignmentEmail(baseArgs());
    expect(out.message.toRecipients).toEqual([
      { emailAddress: { address: 'recruit.one@silverspaceinc.com' } }
    ]);
    const ccs = out.message.ccRecipients.map((r) => r.emailAddress.address);
    expect(ccs).toEqual(expect.arrayContaining([
      'tushar.ahuja@silverspaceinc.com',
      'lead.one@silverspaceinc.com'
    ]));
  });

  it('lowercases + dedupes CC entries', () => {
    const out = buildAssignmentEmail({
      ...baseArgs(),
      managerEmail: 'Tushar.AHUJA@silverspaceinc.com',
      teamLeadEmail: 'TUSHAR.ahuja@silverspaceinc.com',
      permanentCcEmail: 'Tushar.ahuja@silverspaceinc.com'
    });
    const ccs = out.message.ccRecipients.map((r) => r.emailAddress.address);
    expect(ccs).toEqual(['tushar.ahuja@silverspaceinc.com']);
  });

  it('still adds the permanent CC even when manager + teamLead emails are empty', () => {
    const out = buildAssignmentEmail({
      ...baseArgs(),
      managerEmail: '',
      teamLeadEmail: ''
    });
    const ccs = out.message.ccRecipients.map((r) => r.emailAddress.address);
    expect(ccs).toEqual(['tushar.ahuja@silverspaceinc.com']);
  });

  it('attaches each file as a #microsoft.graph.fileAttachment', () => {
    const out = buildAssignmentEmail({
      ...baseArgs(),
      attachments: [
        { id: 'a1', filename: 'resume.pdf', mimeType: 'application/pdf', contentBytesBase64: 'cGRm' },
        { id: 'a2', filename: 'photo.png', mimeType: 'image/png', contentBytesBase64: 'cG5n' }
      ]
    });
    expect(out.message.attachments).toEqual([
      { '@odata.type': '#microsoft.graph.fileAttachment', name: 'resume.pdf', contentType: 'application/pdf', contentBytes: 'cGRm' },
      { '@odata.type': '#microsoft.graph.fileAttachment', name: 'photo.png', contentType: 'image/png', contentBytes: 'cG5n' }
    ]);
  });

  it('always sets saveToSentItems = true and contentType = HTML', () => {
    const out = buildAssignmentEmail(baseArgs());
    expect(out.saveToSentItems).toBe(true);
    expect(out.message.body.contentType).toBe('HTML');
  });

  it('emits an _audit block with the resolved recipients + subject for service-side persistence', () => {
    const out = buildAssignmentEmail(baseArgs());
    expect(out._audit).toMatchObject({
      subject: 'Assignment: Jane Doe – Software Developer – OPT',
      senderEmail: 'sender@silverspaceinc.com',
      to: ['recruit.one@silverspaceinc.com'],
      cc: expect.arrayContaining(['tushar.ahuja@silverspaceinc.com', 'lead.one@silverspaceinc.com']),
      bcc: [],
      attachmentIds: ['a1']
    });
  });
});

describe('buildAssignmentEmail — required-field validation', () => {
  it('throws if Candidate Name is missing', () => {
    expect(() => buildAssignmentEmail({ ...baseArgs(), candidateName: '' }))
      .toThrow(/Candidate Name/);
  });

  it('throws if Recruiter email is missing', () => {
    expect(() => buildAssignmentEmail({ ...baseArgs(), recruiterEmail: '' }))
      .toThrow(/Recruiter email/);
  });

  it('throws if Team Lead is missing', () => {
    expect(() => buildAssignmentEmail({ ...baseArgs(), teamLeadDisplayName: '' }))
      .toThrow(/Team Lead/);
  });

  it('throws if Sender display name is missing', () => {
    expect(() => buildAssignmentEmail({ ...baseArgs(), senderDisplayName: '' }))
      .toThrow(/Sender display name/);
  });

  it('throws if permanentCc is not configured', () => {
    expect(() => buildAssignmentEmail({ ...baseArgs(), permanentCcEmail: '' }))
      .toThrow(/Permanent CC/);
  });

  it('throws if there are no attachments', () => {
    expect(() => buildAssignmentEmail({ ...baseArgs(), attachments: [] }))
      .toThrow(/At least one attachment/);
  });

  it('throws if an attachment is missing required fields', () => {
    expect(() => buildAssignmentEmail({
      ...baseArgs(),
      attachments: [{ id: 'a1', filename: 'r.pdf', mimeType: 'application/pdf' /* no bytes */ }]
    })).toThrow(/Invalid attachment payload/);
  });
});
