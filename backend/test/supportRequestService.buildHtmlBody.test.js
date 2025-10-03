import { supportRequestService } from '../src/services/supportRequestService.js';

describe('supportRequestService.buildHtmlBody', () => {
  const baseData = {
    candidateName: 'Jane Doe',
    technology: 'React',
    endClient: 'Acme Corp',
    jobTitle: 'Frontend Engineer',
    interviewRound: 'Technical Round',
    interviewDateTimeDisplay: 'Jan 1, 2025 10:00 AM',
    durationDisplay: '60 minutes',
    emailId: 'jane@example.com',
    contactNumber: '+1 555 555 5555',
    requestedBy: 'Recruiter <recruiter@example.com>',
  };

  it('renders job description text as paragraphs below the table', () => {
    const html = supportRequestService.buildHtmlBody({
      ...baseData,
      jobDescriptionText: 'First line.\nSecond line.\n\nFinal paragraph.',
    });

    expect(html).toContain('Interview support request details');
    expect(html).toContain('<table');
    expect(html).toContain('<div style="margin-top:16px;">');
    expect(html).toMatch(/First line.<br \/>Second line./);
    expect(html).toMatch(/<p style="margin:0px 0 0/);
    expect(html).toMatch(/<p style="margin:12px 0 0/);
  });

  it('escapes HTML and preserves line breaks inside job description text', () => {
    const html = supportRequestService.buildHtmlBody({
      ...baseData,
      jobDescriptionText: 'Use <script>alert(1)</script> tags with\nmultiple lines.',
    });

    expect(html).toContain('Use &lt;script&gt;alert(1)&lt;/script&gt; tags with<br />multiple lines.');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
