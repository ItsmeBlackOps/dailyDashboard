import { describe, it, expect } from '@jest/globals';
import { validateCandidateQuery } from '../src/middleware/validation.js';

describe('validateCandidateQuery — sort + date-range filter', () => {
  it('accepts the existing sort presets', () => {
    for (const sort of ['updated', 'name', 'expiringIn']) {
      expect(validateCandidateQuery({ sort }).isValid).toBe(true);
    }
  });

  it('accepts the SP3 date-sort presets (Phase B fix)', () => {
    // These were rejected before — selecting them errored the whole list.
    expect(validateCandidateQuery({ sort: 'marketingStart' }).isValid).toBe(true);
    expect(validateCandidateQuery({ sort: 'poDate' }).isValid).toBe(true);
  });

  it('rejects an unknown sort', () => {
    const r = validateCandidateQuery({ sort: 'bogus' });
    expect(r.isValid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/sort must be one of/);
  });

  it('accepts a whitelisted dateField + valid ISO bounds', () => {
    const r = validateCandidateQuery({
      dateField: 'marketingStartDate',
      dateFrom: '2026-06-01T04:00:00.000Z',
      dateTo: '2026-07-01T04:00:00.000Z',
    });
    expect(r.isValid).toBe(true);
  });

  it('rejects a non-whitelisted dateField', () => {
    const r = validateCandidateQuery({ dateField: 'createdAt' });
    expect(r.isValid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/dateField must be one of/);
  });

  it('rejects a malformed date bound', () => {
    const r = validateCandidateQuery({ dateField: 'poDate', dateFrom: 'not-a-date' });
    expect(r.isValid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/dateFrom must be a valid date string/);
  });

  it('ignores absent date-filter args (back-compat)', () => {
    expect(validateCandidateQuery({}).isValid).toBe(true);
    expect(validateCandidateQuery({ search: 'asha', sort: 'name' }).isValid).toBe(true);
  });
});
