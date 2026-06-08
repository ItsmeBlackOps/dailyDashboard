import { describe, it, expect } from '@jest/globals';
import { teamScopeDecision } from '../src/services/userService.js';

describe('teamScopeDecision', () => {
  it('requester with no team → fail-open (allowed, not straggler)', () => {
    expect(teamScopeDecision(null, 'marketing')).toEqual({ allowed: true, straggler: false });
    expect(teamScopeDecision('', 'technical')).toEqual({ allowed: true, straggler: false });
  });

  it('target with no team → fail-open + straggler', () => {
    expect(teamScopeDecision('marketing', null)).toEqual({ allowed: true, straggler: true });
    expect(teamScopeDecision('marketing', '')).toEqual({ allowed: true, straggler: true });
  });

  it('both teamed, same team → allowed', () => {
    expect(teamScopeDecision('marketing', 'marketing')).toEqual({ allowed: true, straggler: false });
  });

  it('both teamed, different team → not allowed', () => {
    expect(teamScopeDecision('marketing', 'technical')).toEqual({ allowed: false, straggler: false });
  });

  it('normalizes case and whitespace', () => {
    expect(teamScopeDecision('  Marketing ', 'MARKETING').allowed).toBe(true);
    expect(teamScopeDecision('Technical', ' marketing ').allowed).toBe(false);
  });
});
