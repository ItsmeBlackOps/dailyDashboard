import { describe, it, expect, afterEach } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { userModel } from '../src/models/User.js';

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

describe('candidateService.resolveDefaultBranchForMam', () => {
  const originalGetUserByEmail = userModel.getUserByEmail;

  afterEach(() => {
    userModel.getUserByEmail = originalGetUserByEmail;
  });

  it('resolves default branch for mapped MAM -> MM', () => {
    userModel.getUserByEmail = (email) => {
      const normalized = String(email || '').toLowerCase();
      if (normalized === 'mam.user@silverspaceinc.com') {
        return {
          email: 'mam.user@silverspaceinc.com',
          role: 'mam',
          manager: 'tushar.ahuja@silverspaceinc.com'
        };
      }
      if (normalized === 'tushar.ahuja@silverspaceinc.com') {
        return {
          email: 'tushar.ahuja@silverspaceinc.com',
          role: 'mm'
        };
      }
      return null;
    };

    const result = candidateService.resolveDefaultBranchForMam({
      email: 'mam.user@silverspaceinc.com',
      role: 'MAM'
    });

    expect(result.branch).toBe('GGR');
    expect(result.mmEmail).toBe('tushar.ahuja@silverspaceinc.com');
  });

  it('returns no branch when manager is not an MM record', () => {
    userModel.getUserByEmail = (email) => {
      const normalized = String(email || '').toLowerCase();
      if (normalized === 'mam.user@silverspaceinc.com') {
        return {
          email: 'mam.user@silverspaceinc.com',
          role: 'mam',
          manager: 'not.mm@silverspaceinc.com'
        };
      }
      if (normalized === 'not.mm@silverspaceinc.com') {
        return {
          email: 'not.mm@silverspaceinc.com',
          role: 'lead'
        };
      }
      return null;
    };

    const result = candidateService.resolveDefaultBranchForMam({
      email: 'mam.user@silverspaceinc.com',
      role: 'MAM'
    });

    expect(result.branch).toBeNull();
    expect(result.reason).toContain('mapping');
  });
});
