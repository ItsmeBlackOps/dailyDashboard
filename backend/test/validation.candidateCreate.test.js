// backend/test/validation.candidateCreate.test.js
import { describe, it, expect } from '@jest/globals';
import { validateCandidateCreate } from '../src/middleware/validation.js';

const base = {
  name: 'Asha Rao', email: 'asha@x.com', technology: 'Software Developer',
  recruiter: 'rec@x.com', branch: 'AHM', resumeLink: 'https://x/r.pdf',
  contact: '+12193688385', experienceYears: 5, visaType: 'H1B', company: 'SST',
  city: 'Austin', state: 'TX',
};

describe('validateCandidateCreate — PRT mandatory fields', () => {
  it('accepts a complete payload and forwards the PRT fields', () => {
    const { isValid, payload, errors } = validateCandidateCreate(base);
    expect(errors).toEqual([]);
    expect(isValid).toBe(true);
    expect(payload).toMatchObject({
      visaType: 'H1B', company: 'SST', experienceYears: 5,
      city: 'Austin', state: 'TX', contact: '+12193688385',
    });
  });

  it('rejects when visaType is missing', () => {
    const { isValid, errors } = validateCandidateCreate({ ...base, visaType: undefined });
    expect(isValid).toBe(false);
    expect(errors.join(' ')).toMatch(/visaType/i);
  });

  it('rejects an unknown visaType / company enum', () => {
    expect(validateCandidateCreate({ ...base, visaType: 'BOGUS' }).isValid).toBe(false);
    expect(validateCandidateCreate({ ...base, company: 'BOGUS' }).isValid).toBe(false);
  });

  it('rejects experienceYears out of 1..20 or non-integer', () => {
    expect(validateCandidateCreate({ ...base, experienceYears: 0 }).isValid).toBe(false);
    expect(validateCandidateCreate({ ...base, experienceYears: 21 }).isValid).toBe(false);
    expect(validateCandidateCreate({ ...base, experienceYears: 2.5 }).isValid).toBe(false);
  });

  it('requires contact', () => {
    expect(validateCandidateCreate({ ...base, contact: '' }).isValid).toBe(false);
  });

  it('requires EAD dates only for EAD-card visas, end > start', () => {
    const opt = { ...base, visaType: 'OPT' }; // OPT is an EAD-card type
    expect(validateCandidateCreate(opt).isValid).toBe(false); // missing EAD
    expect(validateCandidateCreate({ ...opt, eadStartDate: '2026-01-01', eadEndDate: '2025-01-01' }).isValid).toBe(false);
    const ok = validateCandidateCreate({ ...opt, eadStartDate: '2026-01-01', eadEndDate: '2027-01-01' });
    expect(ok.isValid).toBe(true);
    expect(ok.payload).toMatchObject({ eadStartDate: '2026-01-01', eadEndDate: '2027-01-01' });
  });
});
