import { describe, it, expect, jest, afterEach, beforeEach } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { userModel } from '../src/models/User.js';
import { delegationService } from '../src/services/delegationService.js';
import { logger } from '../src/utils/logger.js';

const origGetAllUsers = userModel.getAllUsers;
const origListActive = delegationService.listActiveForUser;

afterEach(() => {
  userModel.getAllUsers = origGetAllUsers;
  delegationService.listActiveForUser = origListActive;
  jest.restoreAllMocks();
});

beforeEach(() => {
  delegationService.listActiveForUser = jest.fn().mockResolvedValue([]);
});

const marketingLead = { email: 'mlead@example.com', role: 'mlead', team: 'marketing' };
const sameTeamRec = { email: 'rec.same@example.com', role: 'recruiter', team: 'marketing', teamLead: 'Mlead' };
const crossTeamRec = { email: 'rec.cross@example.com', role: 'recruiter', team: 'technical', teamLead: 'Mlead' };
const noTeamRec = { email: 'rec.noteam@example.com', role: 'recruiter', teamLead: 'Mlead' };

describe('collectHierarchyEmails — team scoping', () => {
  it('includes a same-team recruiter in both sets', async () => {
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, sameTeamRec, crossTeamRec]);
    const { allSubordinateEmails, recruiterEmails } = await candidateService.collectHierarchyEmails(marketingLead);
    expect(allSubordinateEmails.has('rec.same@example.com')).toBe(true);
    expect(recruiterEmails.has('rec.same@example.com')).toBe(true);
  });

  it('excludes a cross-team recruiter from both sets', async () => {
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, sameTeamRec, crossTeamRec]);
    const { allSubordinateEmails, recruiterEmails } = await candidateService.collectHierarchyEmails(marketingLead);
    expect(allSubordinateEmails.has('rec.cross@example.com')).toBe(false);
    expect(recruiterEmails.has('rec.cross@example.com')).toBe(false);
  });

  it('fail-open: recruiter with no team is included + warns', async () => {
    const warnSpy = jest.spyOn(logger, 'warn');
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, noTeamRec]);
    const { allSubordinateEmails } = await candidateService.collectHierarchyEmails(marketingLead);
    expect(allSubordinateEmails.has('rec.noteam@example.com')).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('team-scope straggler'),
      expect.objectContaining({ email: 'rec.noteam@example.com' }),
    );
  });

  it('fail-open: requester with no team falls back (cross-team included)', async () => {
    const noTeamLead = { ...marketingLead, team: undefined };
    userModel.getAllUsers = jest.fn().mockReturnValue([noTeamLead, crossTeamRec]);
    const { allSubordinateEmails } = await candidateService.collectHierarchyEmails({ email: 'mlead@example.com', role: 'mlead' });
    expect(allSubordinateEmails.has('rec.cross@example.com')).toBe(true);
  });

  it('C19 specific delegation to a cross-team user is still included', async () => {
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, crossTeamRec]);
    delegationService.listActiveForUser = jest.fn().mockResolvedValue([
      { scope: 'specific', subjectEmails: ['rec.cross@example.com'] },
    ]);
    const { allSubordinateEmails, recruiterEmails } = await candidateService.collectHierarchyEmails(marketingLead);
    expect(allSubordinateEmails.has('rec.cross@example.com')).toBe(true);
    expect(recruiterEmails.has('rec.cross@example.com')).toBe(true);
  });

  it('does not bridge through a cross-team intermediate to a same-team report', async () => {
    // mlead(marketing) → midCross(technical, reports to mlead) → deepSame(marketing, reports to midCross).
    // The walk must prune at midCross, so deepSame is unreachable even though it is the requester's team.
    const midCross = { email: 'midcross@example.com', role: 'lead', team: 'technical', teamLead: 'Mlead' };
    const deepSame = { email: 'deepsame@example.com', role: 'recruiter', team: 'marketing', teamLead: 'Midcross' };
    userModel.getAllUsers = jest.fn().mockReturnValue([marketingLead, midCross, deepSame]);
    const { allSubordinateEmails } = await candidateService.collectHierarchyEmails(marketingLead);
    expect(allSubordinateEmails.has('midcross@example.com')).toBe(false);
    expect(allSubordinateEmails.has('deepsame@example.com')).toBe(false); // must not bridge through the cross-team node
  });
});
