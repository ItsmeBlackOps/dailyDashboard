import { describe, it, expect } from 'vitest';
import { isTechnicalTeam } from '../technicalTeam';

describe('isTechnicalTeam', () => {
  it('includes experts and technical leads/AMs (legacy + new)', () => {
    ['user', 'expert', 'lead', 'am', 'USER', ' Expert '].forEach((r) => expect(isTechnicalTeam(r)).toBe(true));
  });
  it('excludes marketing roles and admin', () => {
    ['mm', 'mam', 'mlead', 'recruiter', 'manager', 'admin', '', null, undefined].forEach((r) =>
      expect(isTechnicalTeam(r as any)).toBe(false));
  });
});
