import { describe, it, expect } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';

describe('candidateService.resolveBranchForMm', () => {
  it('returns mapped branch for known MM email', () => {
    const branch = candidateService.resolveBranchForMm('tushar.ahuja@silverspaceinc.com', 'MM');
    expect(branch).toBe('GGR');
  });

  it('is case-insensitive when matching email', () => {
    const branch = candidateService.resolveBranchForMm('ARYAN.MISHRA@silverspaceinc.com', 'MM');
    expect(branch).toBe('LKN');
  });

  it('returns null for unknown MM user', () => {
    const branch = candidateService.resolveBranchForMm('unknown.mm@silverspaceinc.com', 'MM');
    expect(branch).toBeNull();
  });

  it('returns null for non-MM roles', () => {
    const branch = candidateService.resolveBranchForMm('tushar.ahuja@silverspaceinc.com', 'admin');
    expect(branch).toBeNull();
  });
});
