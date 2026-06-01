import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { candidateModel } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';
import { userService } from '../src/services/userService.js';

// PRT — Move to Marketing bulk action.
// Gate: toLegacyRole(role, team) ∈ {admin, mm, mam}. Per-candidate scope
// check via the recruiter; sets team='marketing' + editHistory.

const originalGetCandidateById = candidateModel.getCandidateById;
const originalUpdateCandidateById = candidateModel.updateCandidateById;
const originalGetUserByEmail = userModel.getUserByEmail;
const originalCollectManageableUsers = userService.collectManageableUsers;

afterEach(() => {
  candidateModel.getCandidateById = originalGetCandidateById;
  candidateModel.updateCandidateById = originalUpdateCandidateById;
  userModel.getUserByEmail = originalGetUserByEmail;
  userService.collectManageableUsers = originalCollectManageableUsers;
  jest.restoreAllMocks();
});

function setup(candidate = {}) {
  const cand = {
    _id: 'cand1',
    'Candidate Name': 'Jane Doe',
    recruiter: 'recruit.one@company.com',
    Recruiter: 'recruit.one@company.com',
    team: null,
    ...candidate
  };
  candidateModel.getCandidateById = jest.fn().mockResolvedValue(cand);
  candidateModel.updateCandidateById = jest.fn().mockResolvedValue({ ...cand, team: 'marketing' });
  userService.collectManageableUsers = jest.fn().mockReturnValue([
    { email: 'recruit.one@company.com', role: 'recruiter', active: true }
  ]);
  userModel.getUserByEmail = jest.fn((email) => ({ email, active: true }));
  return cand;
}

describe('candidateService.moveCandidatesToMarketing — gate', () => {
  it('allows admin / mm / mam (incl. C20 manager + marketing assistantManager)', async () => {
    for (const actor of [
      { email: 'a@co.com', role: 'admin' },
      { email: 'mm@co.com', role: 'mm' },
      { email: 'mam@co.com', role: 'mam' },
      { email: 'mgr@co.com', role: 'manager' },
      { email: 'am@co.com', role: 'assistantManager', team: 'marketing' }
    ]) {
      setup();
      const result = await candidateService.moveCandidatesToMarketing(actor, ['cand1']);
      expect(result.moved).toEqual(['cand1']);
      expect(result.failed).toEqual([]);
    }
  });

  it('rejects technical AM / team leads / recruiters with 403', async () => {
    for (const actor of [
      { email: 'am@co.com', role: 'assistantManager', team: 'technical' },
      { email: 'lead@co.com', role: 'mlead' },
      { email: 'tl@co.com', role: 'teamLead', team: 'marketing' },
      { email: 'rec@co.com', role: 'recruiter' }
    ]) {
      setup();
      await expect(
        candidateService.moveCandidatesToMarketing(actor, ['cand1'])
      ).rejects.toMatchObject({ statusCode: 403 });
    }
  });

  it('401 when the actor has no role', async () => {
    setup();
    await expect(
      candidateService.moveCandidatesToMarketing({ email: 'x@y' }, ['cand1'])
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('400 when no candidate ids are supplied', async () => {
    setup();
    await expect(
      candidateService.moveCandidatesToMarketing({ email: 'mm@co.com', role: 'mm' }, [])
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('candidateService.moveCandidatesToMarketing — behaviour', () => {
  it('sets team=marketing and pushes an editHistory entry', async () => {
    setup();
    await candidateService.moveCandidatesToMarketing({ email: 'mm@co.com', role: 'mm' }, ['cand1']);
    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith(
      'cand1',
      expect.objectContaining({
        team: 'marketing',
        _changedBy: 'mm@co.com',
        _source: 'move-to-marketing',
        _pushEditHistory: expect.arrayContaining([
          expect.objectContaining({ field: 'team', newValue: 'marketing', oldValue: null })
        ])
      })
    );
  });

  it('puts an out-of-scope candidate in failed[] and does not write it', async () => {
    setup({ recruiter: 'stranger@other.com', Recruiter: 'stranger@other.com' });
    const result = await candidateService.moveCandidatesToMarketing(
      { email: 'mm@co.com', role: 'mm' },
      ['cand1']
    );
    expect(result.moved).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('cand1');
    expect(candidateModel.updateCandidateById).not.toHaveBeenCalled();
  });

  it('is idempotent — a candidate already in marketing is reported moved without a write', async () => {
    setup({ team: 'marketing' });
    const result = await candidateService.moveCandidatesToMarketing(
      { email: 'mm@co.com', role: 'mm' },
      ['cand1']
    );
    expect(result.moved).toEqual(['cand1']);
    expect(candidateModel.updateCandidateById).not.toHaveBeenCalled();
  });
});
