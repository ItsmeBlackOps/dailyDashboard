import { describe, it, expect } from '@jest/globals';
import { candidateModel } from '../src/models/Candidate.js';

// Regression: mapDocumentToCandidate previously dropped the PRT fields that
// DEFAULT_PROJECTION fetches (attachments, teamLead, visaType, company, EAD,
// …). That made the candidate-detail API return attachments:[] for every
// candidate, so the "Send Assignment Email" gate (attachmentsCount > 0) could
// never be satisfied — the button was permanently disabled even when the
// candidate had a stored team lead and an uploaded attachment.

describe('candidateModel.mapDocumentToCandidate — PRT fields', () => {
  const baseDoc = () => ({
    _id: { toString: () => 'abc123' },
    'Candidate Name': 'Rohan Reddy Rondla',
    Recruiter: 'saileshchandra@vizvainc.com',
    teamLead: 'nusrat.perween@vizvainc.com',
    experienceYears: 5,
    visaType: 'H1B',
    company: 'SST',
    eadStartDate: null,
    eadEndDate: null,
    city: 'Lucknow',
    state: 'UP',
    ackEmail: 'Pending',
    ackEmailAt: null,
    team: 'marketing',
    marketingStartDate: null,
    attachments: [{ id: 'a1', filename: 'resume.pdf' }],
  });

  it('surfaces attachments, teamLead, and visa/company/experience from the document', () => {
    const c = candidateModel.mapDocumentToCandidate(baseDoc());
    expect(Array.isArray(c.attachments)).toBe(true);
    expect(c.attachments).toHaveLength(1);
    expect(c.teamLead).toBe('nusrat.perween@vizvainc.com');
    expect(c.visaType).toBe('H1B');
    expect(c.company).toBe('SST');
    expect(c.experienceYears).toBe(5);
    expect(c.city).toBe('Lucknow');
    expect(c.state).toBe('UP');
  });

  it('defaults attachments to [] and PRT fields to null when absent (e.g. list projection)', () => {
    const c = candidateModel.mapDocumentToCandidate({
      _id: { toString: () => 'x' },
      'Candidate Name': 'No PRT',
      Recruiter: 'r@x.com',
    });
    expect(c.attachments).toEqual([]);
    expect(c.teamLead ?? null).toBeNull();
    expect(c.visaType ?? null).toBeNull();
    expect(c.company ?? null).toBeNull();
  });
});
