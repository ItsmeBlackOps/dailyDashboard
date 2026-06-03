import { describe, it, expect } from '@jest/globals';
import { marketingInfoMissingFilter, EAD_REQUIRED_VISA_TYPES } from '../src/models/Candidate.js';

describe('marketingInfoMissingFilter', () => {
  it('returns an $or with visaType + company emptiness branches and an EAD-conditional branch', () => {
    const f = marketingInfoMissingFilter();
    expect(Array.isArray(f.$or)).toBe(true);
    expect(f.$or).toEqual(expect.arrayContaining([
      { visaType: { $in: [null, ''] } },
      { visaType: { $exists: false } },
      { company: { $in: [null, ''] } },
      { company: { $exists: false } },
    ]));
    const eadBranch = f.$or.find((c) => c.$and);
    expect(eadBranch).toBeTruthy();
    expect(eadBranch.$and[0]).toEqual({ visaType: { $in: Array.from(EAD_REQUIRED_VISA_TYPES) } });
    expect(Array.isArray(eadBranch.$and[1].$or)).toBe(true);
  });

  it('is a pure function (no args, stable shape)', () => {
    expect(JSON.stringify(marketingInfoMissingFilter())).toBe(JSON.stringify(marketingInfoMissingFilter()));
  });
});
