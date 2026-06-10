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

  describe('"EAD not started" waiver', () => {
    it('waives the EAD-date requirement for EAD-card visas when eadNotStarted is true', () => {
      const opt = { ...base, visaType: 'OPT' };
      // Without the flag this is invalid (covered above); with it, valid.
      const res = validateCandidateCreate({ ...opt, eadNotStarted: true });
      expect(res.isValid).toBe(true);
      expect(res.errors).toEqual([]);
    });

    it('forwards eadNotStarted: true to the service and omits the EAD dates', () => {
      const res = validateCandidateCreate({ ...base, visaType: 'OPT', eadNotStarted: true });
      expect(res.payload.eadNotStarted).toBe(true);
      expect(res.payload).not.toHaveProperty('eadStartDate');
      expect(res.payload).not.toHaveProperty('eadEndDate');
    });

    it('does NOT forward eadNotStarted when the flag is absent (so it is never persisted by default)', () => {
      const res = validateCandidateCreate({ ...base, visaType: 'H1B' });
      expect(res.payload).not.toHaveProperty('eadNotStarted');
    });

    it('still rejects a missing EAD start date when the flag is absent', () => {
      expect(validateCandidateCreate({ ...base, visaType: 'OPT' }).isValid).toBe(false);
    });
  });
});
