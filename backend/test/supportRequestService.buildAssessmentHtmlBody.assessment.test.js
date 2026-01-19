import { supportRequestService } from '../src/services/supportRequestService.js';

const baseData = {
  candidateName: 'Jane Doe',
  technology: 'React',
  candidateEmail: 'jane@example.com',
  contactNumber: '+1 555 555 5555',
  endClient: 'Acme Corp',
  jobTitle: 'Frontend Engineer',
  assessmentDateTimeDisplay: 'Jan 1, 2025 at 09:00 AM EST',
  durationDisplay: '45 minutes',
  additionalInfo: '',
  jobDescriptionText: '',
  screeningDone: false
};

describe('supportRequestService.buildAssessmentHtmlBody', () => {
  it('highlights the assessment received row', () => {
    const html = supportRequestService.buildAssessmentHtmlBody(baseData);
    expect(html).toContain(baseData.assessmentDateTimeDisplay);
    expect(html).toMatch(/background:#fef08a/);
  });

  it('renders additional info before the summary table', () => {
    const html = supportRequestService.buildAssessmentHtmlBody({
      ...baseData,
      additionalInfo: 'Candidate shared GitHub repo link.'
    });

    const additionalIndex = html.indexOf('Candidate shared GitHub repo link.');
    const tableIndex = html.indexOf('<table');
    expect(additionalIndex).toBeGreaterThan(-1);
    expect(tableIndex).toBeGreaterThan(additionalIndex);
  });

  it('escapes html and appends job description section', () => {
    const html = supportRequestService.buildAssessmentHtmlBody({
      ...baseData,
      jobDescriptionText: 'Use <script>alert(1)</script> safely.'
    });

    expect(html).toContain('Job Description');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Use &lt;script&gt;alert(1)&lt;/script&gt; safely.');
  });

  it('shows screening priority message when requested', () => {
    const html = supportRequestService.buildAssessmentHtmlBody({
      ...baseData,
      screeningDone: true
    });

    expect(html).toContain('Screening is done so prioritize this task.');
  });
});
