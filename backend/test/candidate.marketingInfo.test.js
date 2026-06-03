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

import { candidateService } from '../src/services/candidateService.js';

describe('candidateService.missingMarketingFields', () => {
  it('flags blank visaType and company', () => {
    const m = candidateService.missingMarketingFields({ visaType: '', company: null });
    expect(m).toEqual(expect.arrayContaining(['visaType', 'company']));
  });

  it('requires EAD dates only for EAD-card visa types', () => {
    expect(candidateService.missingMarketingFields({ visaType: 'OPT', company: 'SST' }))
      .toEqual(expect.arrayContaining(['eadStartDate', 'eadEndDate']));
    expect(candidateService.missingMarketingFields({ visaType: 'H1B', company: 'SST' }))
      .toEqual([]);
  });

  it('candidateNeedsMarketingInfo is true iff something is missing', () => {
    expect(candidateService.candidateNeedsMarketingInfo({ visaType: 'H1B', company: 'VCS' })).toBe(false);
    expect(candidateService.candidateNeedsMarketingInfo({ visaType: '', company: 'VCS' })).toBe(true);
  });
});
