import { describe, it, expect } from '@jest/globals';
import { candidateModel, toIsoDate, toIso } from '../src/models/Candidate.js';

// SP3 Phase A — normalize candidate date fields to a consistent ISO form on
// read. eadStartDate/eadEndDate become date-only YYYY-MM-DD; marketingStartDate
// and ackEmailAt become full ISO. The helpers accept Date | ISO string |
// MM/DD/YYYY | null and never throw; unparseable input → null.

describe('toIsoDate (date-only YYYY-MM-DD)', () => {
  it('formats a Date to YYYY-MM-DD (UTC calendar date)', () => {
    expect(toIsoDate(new Date('2026-06-03'))).toBe('2026-06-03');
  });

  it('passes an ISO YYYY-MM-DD string through unchanged', () => {
    expect(toIsoDate('2026-06-03')).toBe('2026-06-03');
  });

  it('takes the date part of a full ISO datetime string', () => {
    expect(toIsoDate('2026-06-03T13:00:00.000Z')).toBe('2026-06-03');
  });

  it('converts MM/DD/YYYY to YYYY-MM-DD', () => {
    expect(toIsoDate('06/03/2026')).toBe('2026-06-03');
  });

  it('returns null for empty / null / undefined / garbage', () => {
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoDate(undefined)).toBeNull();
    expect(toIsoDate('garbage')).toBeNull();
  });
});

describe('toIso (full ISO datetime)', () => {
  it('formats a Date to a full ISO string', () => {
    expect(toIso(new Date('2026-01-02T00:00:00.000Z'))).toBe('2026-01-02T00:00:00.000Z');
  });

  it('passes a full ISO string through (normalized)', () => {
    expect(toIso('2026-01-02T00:00:00.000Z')).toBe('2026-01-02T00:00:00.000Z');
  });

  it('promotes a YYYY-MM-DD string to ISO midnight UTC', () => {
    expect(toIso('2026-06-03')).toBe('2026-06-03T00:00:00.000Z');
  });

  it('returns null for empty / null / garbage', () => {
    expect(toIso('')).toBeNull();
    expect(toIso(null)).toBeNull();
    expect(toIso('garbage')).toBeNull();
  });
});

describe('mapDocumentToCandidate — date normalization', () => {
  it('normalizes ead dates to YYYY-MM-DD and marketingStartDate to ISO', () => {
    const out = candidateModel.mapDocumentToCandidate({
      _id: 'c1',
      eadStartDate: '06/03/2026',
      eadEndDate: new Date('2027-06-03'),
      marketingStartDate: new Date('2026-01-02T00:00:00.000Z'),
      ackEmailAt: '2026-02-03T10:30:00.000Z'
    });

    expect(out.eadStartDate).toBe('2026-06-03');
    expect(out.eadEndDate).toBe('2027-06-03');
    expect(out.marketingStartDate).toBe('2026-01-02T00:00:00.000Z');
    expect(out.ackEmailAt).toBe('2026-02-03T10:30:00.000Z');
  });

  it('leaves null date fields as null', () => {
    const out = candidateModel.mapDocumentToCandidate({
      _id: 'c2',
      eadStartDate: null,
      eadEndDate: null,
      marketingStartDate: null,
      ackEmailAt: null
    });

    expect(out.eadStartDate).toBeNull();
    expect(out.eadEndDate).toBeNull();
    expect(out.marketingStartDate).toBeNull();
    expect(out.ackEmailAt).toBeNull();
  });
});
