import { describe, it, expect } from 'vitest';
import { normalizeCandidateRow } from '../normalizeCandidateRow';

describe('normalizeCandidateRow', () => {
  it('fills the row defaults the list relies on', () => {
    const row = normalizeCandidateRow({ id: 'c1', name: 'Jane' } as any);
    expect(row).toMatchObject({
      id: 'c1',
      recruiter: '',
      recruiterRaw: '',
      expert: '',
      expertRaw: '',
      resumeLink: '',
      resumeUnderstanding: false,
    });
  });

  it('preserves provided values and coerces resumeUnderstanding to boolean', () => {
    const row = normalizeCandidateRow({
      id: 'c2', recruiter: 'Rec', recruiterRaw: 'rec@x.com', resumeLink: 'http://x/r.pdf',
      resumeUnderstanding: 1, resumeUnderstandingStatus: 'done', workflowStatus: 'awaiting',
    } as any);
    expect(row.recruiter).toBe('Rec');
    expect(row.resumeLink).toBe('http://x/r.pdf');
    expect(row.resumeUnderstanding).toBe(true);
    expect(row.resumeUnderstandingStatus).toBe('done');
    expect(row.workflowStatus).toBe('awaiting');
  });
});
