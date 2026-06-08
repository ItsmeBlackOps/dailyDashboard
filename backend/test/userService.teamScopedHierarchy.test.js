import { describe, it, expect, jest, afterEach, beforeEach } from '@jest/globals';
import { teamScopeDecision } from '../src/services/userService.js';
import { userService } from '../src/services/userService.js';
import { userModel } from '../src/models/User.js';
import { delegationService } from '../src/services/delegationService.js';
import { logger } from '../src/utils/logger.js';

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

const origGetAllUsers = userModel.getAllUsers;
const origListActive = delegationService.listActiveForUser;

afterEach(() => {
  userModel.getAllUsers = origGetAllUsers;
  delegationService.listActiveForUser = origListActive;
  jest.restoreAllMocks();
});

beforeEach(() => {
  // No delegations by default — isolate the own-subtree team scoping.
  delegationService.listActiveForUser = jest.fn().mockResolvedValue([]);
});

// Requester "mlead@example.com" → derived display name "Mlead". Reports point
// teamLead at "Mlead". deriveDisplayNameFromEmail('mlead@...') === 'Mlead'.
const marketingLead = { email: 'mlead@example.com', role: 'mlead', team: 'marketing' };
const sameTeamRec = { email: 'rec.same@example.com', role: 'recruiter', team: 'marketing', teamLead: 'Mlead' };
const crossTeamRec = { email: 'rec.cross@example.com', role: 'recruiter', team: 'technical', teamLead: 'Mlead' };
const noTeamRec = { email: 'rec.noteam@example.com', role: 'recruiter', teamLead: 'Mlead' };

describe('isUserInRequesterHierarchy — team scoping', () => {
  it('includes a same-team direct report', async () => {
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, sameTeamRec, crossTeamRec]);
    const result = await userService.isUserInRequesterHierarchy({ email: 'mlead@example.com' }, 'rec.same@example.com');
    expect(result).toBe(true);
  });

  it('excludes a cross-team report even though its teamLead points at the requester', async () => {
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, sameTeamRec, crossTeamRec]);
    const result = await userService.isUserInRequesterHierarchy({ email: 'mlead@example.com' }, 'rec.cross@example.com');
    expect(result).toBe(false);
  });

  it('fail-open: target with no team is still included + warns', async () => {
    const warnSpy = jest.spyOn(logger, 'warn');
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, noTeamRec]);
    const result = await userService.isUserInRequesterHierarchy({ email: 'mlead@example.com' }, 'rec.noteam@example.com');
    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('team-scope straggler'),
      expect.objectContaining({ email: 'rec.noteam@example.com' }),
    );
  });

  it('fail-open: requester with no team falls back to old behavior (cross-team reachable)', async () => {
    const noTeamLead = { ...marketingLead, team: undefined };
    userModel.getAllUsers = jest.fn().mockReturnValue([noTeamLead, crossTeamRec]);
    const result = await userService.isUserInRequesterHierarchy({ email: 'mlead@example.com' }, 'rec.cross@example.com');
    expect(result).toBe(true);
  });

  it('C19 delegation to a cross-team user still resolves true (delegations are not team-gated)', async () => {
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, crossTeamRec]);
    delegationService.listActiveForUser = jest.fn().mockResolvedValue([
      { scope: 'specific', subjectEmails: ['rec.cross@example.com'] },
    ]);
    const result = await userService.isUserInRequesterHierarchy({ email: 'mlead@example.com' }, 'rec.cross@example.com');
    expect(result).toBe(true);
  });

  it('bridge: a same-team node behind a cross-team intermediate is unreachable (traversal is pruned, not just inclusion)', async () => {
    // requester(marketing) → techMid(technical, reports to requester) → deepRec(marketing, reports to techMid)
    // techMid is cross-team, so the walk must prune it AND everything behind it —
    // even though deepRec is the same team as the requester.
    const techMid = { email: 'techmid@example.com', role: 'lead', team: 'technical', teamLead: 'Mlead' };
    const deepRec = { email: 'deeprec@example.com', role: 'recruiter', team: 'marketing', teamLead: 'Techmid' };
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, techMid, deepRec]);

    // The cross-team intermediate itself is excluded:
    expect(await userService.isUserInRequesterHierarchy({ email: 'mlead@example.com' }, 'techmid@example.com')).toBe(false);
    // And the same-team node behind it is unreachable because traversal stops at the bridge:
    expect(await userService.isUserInRequesterHierarchy({ email: 'mlead@example.com' }, 'deeprec@example.com')).toBe(false);
  });
});
