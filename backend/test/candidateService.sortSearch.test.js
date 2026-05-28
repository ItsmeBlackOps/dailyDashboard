import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { candidateModel } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';

// PRT Phase 5 — sort + email-ID search wiring.
//
// These tests pin down the new contract added in Phase 5:
//
//   * `sort` is a whitelisted string passed through verbatim to the
//     model layer. Unknown strings are dropped (the model picks a
//     default), strings outside the whitelist never reach Mongo.
//   * The model-level search filter matches Candidate Name, Email ID
//     and Recruiter via $or (this is asserted in the model test below).
//
// We mock the model and watch the args that come in.

const originalGetCandidatesByBranch = candidateModel.getCandidatesByBranch;
const originalGetAllCandidates = candidateModel.getAllCandidates;
const originalGetCandidatesByRecruiters = candidateModel.getCandidatesByRecruiters;
const originalGetAllUsers = userModel.getAllUsers;

afterEach(() => {
  candidateModel.getCandidatesByBranch = originalGetCandidatesByBranch;
  candidateModel.getAllCandidates = originalGetAllCandidates;
  candidateModel.getCandidatesByRecruiters = originalGetCandidatesByRecruiters;
  userModel.getAllUsers = originalGetAllUsers;
  jest.restoreAllMocks();
});

describe('candidateService.resolveSortKey', () => {
  it('returns whitelisted keys verbatim', () => {
    expect(candidateService.resolveSortKey('updated')).toBe('updated');
    expect(candidateService.resolveSortKey('name')).toBe('name');
    expect(candidateService.resolveSortKey('expiringIn')).toBe('expiringIn');
  });

  it('rejects unknown / malformed values', () => {
    expect(candidateService.resolveSortKey('haxx')).toBeUndefined();
    expect(candidateService.resolveSortKey('')).toBeUndefined();
    expect(candidateService.resolveSortKey(undefined)).toBeUndefined();
    expect(candidateService.resolveSortKey(42)).toBeUndefined();
    expect(candidateService.resolveSortKey({ $ne: null })).toBeUndefined();
  });
});

describe('candidateService.fetchCandidatesByBranch — sort/search pass-through', () => {
  it('forwards sort + escaped search pattern to the model', async () => {
    candidateModel.getCandidatesByBranch = jest.fn().mockResolvedValue([]);
    await candidateService.fetchCandidatesByBranch(
      { email: 'admin@co.com', role: 'admin', team: 'marketing' },
      'GGR',
      { search: 'jane.doe@x.com', sort: 'expiringIn' }
    );
    expect(candidateModel.getCandidatesByBranch).toHaveBeenCalledTimes(1);
    const [branch, opts] = candidateModel.getCandidatesByBranch.mock.calls[0];
    expect(branch).toBe('GGR');
    // buildSearchPattern strips dangerous regex chars; the dot is escaped
    expect(opts.search).toMatch(/jane\\\.doe@x\\\.com/);
    expect(opts.sort).toBe('expiringIn');
  });

  it('drops unknown sort values so the model picks its default', async () => {
    candidateModel.getCandidatesByBranch = jest.fn().mockResolvedValue([]);
    await candidateService.fetchCandidatesByBranch(
      { email: 'admin@co.com', role: 'admin' },
      'GGR',
      { sort: '../etc/passwd' }
    );
    const [, opts] = candidateModel.getCandidatesByBranch.mock.calls[0];
    expect(opts.sort).toBeUndefined();
  });
});

describe('candidateService.fetchAllCandidates — sort/search pass-through', () => {
  it('forwards sort to the admin path', async () => {
    candidateModel.getAllCandidates = jest.fn().mockResolvedValue([]);
    userModel.getAllUsers = jest.fn().mockReturnValue([]);
    await candidateService.fetchAllCandidates(
      { email: 'admin@co.com', role: 'admin' },
      { sort: 'name' }
    );
    const [opts] = candidateModel.getAllCandidates.mock.calls[0];
    expect(opts.sort).toBe('name');
  });
});

describe('candidateService.fetchCandidatesByRecruiters — sort/search pass-through', () => {
  it('forwards sort + search to the recruiter-scoped path', async () => {
    candidateModel.getCandidatesByRecruiters = jest.fn().mockResolvedValue([]);
    await candidateService.fetchCandidatesByRecruiters(
      { email: 'mam@co.com', role: 'mam' },
      ['rec1@co.com'],
      { search: 'jane', sort: 'updated' }
    );
    const [, opts] = candidateModel.getCandidatesByRecruiters.mock.calls[0];
    expect(opts.search).toBe('jane');
    expect(opts.sort).toBe('updated');
  });
});
