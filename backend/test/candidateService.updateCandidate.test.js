import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { candidateModel } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';
import { userService } from '../src/services/userService.js';

const originalUpdate = candidateModel.updateCandidateById;
const originalGetByBranch = candidateModel.getCandidatesByBranch;
const originalGetByRecruiters = candidateModel.getCandidatesByRecruiters;
const originalGetByExperts = candidateModel.getCandidatesByExperts;
const originalGetAllUsers = userModel.getAllUsers;
const originalCollectManageableUsers = userService.collectManageableUsers;

afterEach(() => {
  candidateModel.updateCandidateById = originalUpdate;
  candidateModel.getCandidatesByBranch = originalGetByBranch;
  candidateModel.getCandidatesByRecruiters = originalGetByRecruiters;
  candidateModel.getCandidatesByExperts = originalGetByExperts;
  userModel.getAllUsers = originalGetAllUsers;
  userService.collectManageableUsers = originalCollectManageableUsers;
  jest.restoreAllMocks();
});

describe('candidateService.updateCandidateDetails', () => {
  it('formats fields and updates candidate for MAM', async () => {
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({
      id: 'abc123',
      name: 'john doe',
      branch: 'LKN',
      recruiter: 'priya.singh@vizvainc.com',
      expert: 'anita shah',
      technology: 'react js',
      email: 'JOHN.DOE@EXAMPLE.COM',
      contact: '9876543210'
    });

    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'priya.singh@vizvainc.com', role: 'recruiter' },
      { email: 'manish.mehta@vizvainc.com', role: 'MAM' }
    ]);

    const result = await candidateService.updateCandidateDetails(
      { email: 'mam.user@vizvainc.com', role: 'MAM' },
      'abc123',
      {
        name: 'john DOE',
        email: 'JOHN.DOE@EXAMPLE.COM',
        technology: 'react js',
        recruiter: 'priya.singh@vizvainc.com'
      }
    );

    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith('abc123', {
      name: 'John Doe',
      email: 'john.doe@example.com',
      technology: 'React Js',
      recruiter: 'priya.singh@vizvainc.com'
    });

    expect(result).toMatchObject({
      id: 'abc123',
      name: 'John Doe',
      email: 'john.doe@example.com',
      technology: 'React Js',
      recruiter: 'Priya Singh',
      recruiterRaw: 'priya.singh@vizvainc.com',
      expert: 'Anita Shah'
    });
  });

  it('rejects updates from unauthorized roles', async () => {
    candidateModel.updateCandidateById = jest.fn();

    await expect(
      candidateService.updateCandidateDetails(
        { email: 'viewer@vizvainc.com', role: 'user' },
        'abc123',
        { name: 'Test' }
      )
    ).rejects.toThrow('Access denied');
  });

  it('allows admin updates when valid fields are provided', async () => {
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({
      id: 'abc123',
      name: 'john doe',
      branch: 'GGR',
      recruiter: 'recruiter@example.com',
      expert: 'expert@example.com',
      technology: 'react',
      email: 'john.doe@example.com',
      contact: '+11234567890'
    });

    await candidateService.updateCandidateDetails(
      { email: 'admin@example.com', role: 'admin' },
      'abc123',
      { expert: 'expert@example.com' }
    );

    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith('abc123', {
      expert: 'expert@example.com'
    });
  });

  it('validates email format before updating', async () => {
    await expect(
      candidateService.updateCandidateDetails(
        { email: 'mm.user@vizvainc.com', role: 'MM' },
        'abc123',
        { email: 'invalid-email' }
      )
    ).rejects.toThrow('Invalid email address');
  });

  it('rejects invalid branch updates outside allowed whitelist', async () => {
    await expect(
      candidateService.updateCandidateDetails(
        { email: 'mm.user@vizvainc.com', role: 'MM' },
        'abc123',
        { branch: 'XYZ' }
      )
    ).rejects.toThrow('Branch must be one of GGR, LKN, AHM');
  });

  it('allows MLEAD to update recruiter assignments', async () => {
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({
      id: 'xyz789',
      name: 'alice smith',
      branch: 'LKN',
      recruiter: 'recruiter.one@vizvainc.com',
      expert: 'john doe',
      technology: 'node js',
      email: 'alice.smith@vizvainc.com',
      contact: '1234567890'
    });

    const result = await candidateService.updateCandidateDetails(
      { email: 'mlead.one@vizvainc.com', role: 'mlead' },
      'xyz789',
      {
        recruiter: 'recruiter.one@vizvainc.com'
      }
    );

    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith('xyz789', {
      recruiter: 'recruiter.one@vizvainc.com'
    });

    expect(result).toMatchObject({ recruiter: 'Recruiter One' });
  });

  it('restricts recruiter updates to name technology email', async () => {
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({
      id: 'rec123',
      name: 'alice smith',
      branch: 'DEL',
      recruiter: 'recruiter.one@vizvainc.com',
      expert: 'john doe',
      technology: 'node js',
      email: 'alice.smith@vizvainc.com',
      contact: '1234567890'
    });

    await candidateService.updateCandidateDetails(
      { email: 'recruiter.one@vizvainc.com', role: 'recruiter' },
      'rec123',
      {
        name: 'ALICE SMITH',
        email: 'ALICE.SMITH@VIZVAINC.COM',
        technology: 'node js',
        contact: '1234567890'
      }
    );

    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith('rec123', {
      name: 'Alice Smith',
      email: 'alice.smith@vizvainc.com',
      technology: 'Node Js',
      contact: '+11234567890'
    });
  });

  it('allows lead to update expert assignment only', async () => {
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({
      id: 'lead123',
      name: 'jane doe',
      branch: 'DEL',
      recruiter: 'recruit.one@company.com',
      expert: 'new.expert@company.com',
      technology: 'react js',
      email: 'jane.doe@example.com',
      contact: '555'
    });

    const result = await candidateService.updateCandidateDetails(
      { email: 'lead.user@company.com', role: 'lead' },
      'lead123',
      { expert: 'NEW.EXPERT@COMPANY.COM', name: 'should ignore' }
    );

    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith('lead123', {
      expert: 'new.expert@company.com'
    });

    expect(result).toMatchObject({
      id: 'lead123',
      name: 'Jane Doe',
      expert: 'New Expert',
      expertRaw: 'new.expert@company.com'
    });
  });

  it('rejects lead updates without expert changes', async () => {
    candidateModel.updateCandidateById = jest.fn();

    await expect(
      candidateService.updateCandidateDetails(
        { email: 'lead.user@company.com', role: 'lead' },
        'lead123',
        { name: 'Attempted Name' }
      )
    ).rejects.toThrow('No changes provided');

    expect(candidateModel.updateCandidateById).not.toHaveBeenCalled();
  });

  it('allows AM to update expert assignment only', async () => {
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({
      id: 'am123',
      name: 'jane doe',
      branch: 'DEL',
      recruiter: 'recruit.one@company.com',
      expert: 'lead.user@company.com',
      technology: 'react js',
      email: 'jane.doe@example.com',
      contact: '555'
    });

    const result = await candidateService.updateCandidateDetails(
      { email: 'am.user@company.com', role: 'AM' },
      'am123',
      { expert: 'LEAD.USER@COMPANY.COM', name: 'should ignore' }
    );

    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith('am123', {
      expert: 'lead.user@company.com'
    });

    expect(result).toMatchObject({
      id: 'am123',
      expert: 'Lead User',
      expertRaw: 'lead.user@company.com'
    });
  });

  it('prevents MM from updating expert assignment', async () => {
    candidateModel.updateCandidateById = jest.fn().mockResolvedValue({
      id: 'mm123',
      name: 'john doe',
      branch: 'DEL',
      recruiter: 'recruiter.one@company.com',
      expert: 'existing.expert@company.com',
      technology: 'react js',
      email: 'john.doe@example.com',
      contact: '555'
    });

    await candidateService.updateCandidateDetails(
      { email: 'mm.user@company.com', role: 'MM' },
      'mm123',
      { name: 'John Doe', expert: 'new.expert@company.com' }
    );

    expect(candidateModel.updateCandidateById).toHaveBeenCalledWith('mm123', {
      name: 'John Doe'
    });
  });
});

describe('candidateService.getCandidatesForUser expert scopes', () => {
  it('returns expert scoped data for lead including direct users', async () => {
    candidateModel.getCandidatesByExperts = jest.fn().mockResolvedValue([
      {
        id: 'cand1',
        name: 'john doe',
        branch: 'DEL',
        recruiter: 'recruit.one@company.com',
        expert: 'lead.user@company.com',
        technology: 'react js',
        email: 'john.doe@example.com',
        contact: '111'
      }
    ]);

    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'direct.user@company.com', role: 'user', teamLead: 'Lead User' },
      { email: 'recruit.one@company.com', role: 'recruiter', teamLead: 'Lead User' },
      { email: 'someone.else@company.com', role: 'user', teamLead: 'Other Lead' }
    ]);
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruit.one@company.com', role: 'recruiter', active: true }
    ]);

    const result = await candidateService.getCandidatesForUser(
      { email: 'lead.user@company.com', role: 'lead' },
      { limit: 25, search: 'React' }
    );

    expect(candidateModel.getCandidatesByExperts).toHaveBeenCalledWith(
      ['lead.user@company.com', 'direct.user@company.com'],
      { search: 'React' }
    );

    expect(result.scope).toEqual({
      type: 'expert',
      value: ['lead.user@company.com', 'direct.user@company.com']
    });

    expect(result.meta).toMatchObject({
      experts: ['lead.user@company.com', 'direct.user@company.com'],
      hasSearch: true
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: 'cand1',
      name: 'John Doe',
      expert: 'Lead User',
      expertRaw: 'lead.user@company.com',
      recruiter: 'Recruit One',
      recruiterRaw: 'recruit.one@company.com',
      technology: 'React Js'
    });

    expect(result.options?.recruiterChoices).toEqual([
      { value: 'lead.user@company.com', label: 'Lead User' },
      { value: 'recruit.one@company.com', label: 'Recruit One' }
    ]);

    expect(result.options?.expertChoices).toEqual([
      { value: 'direct.user@company.com', label: 'Direct User' },
      { value: 'lead.user@company.com', label: 'Lead User' }
    ]);
  });

  it('returns self scoped data for expert user', async () => {
    candidateModel.getCandidatesByExperts = jest.fn().mockResolvedValue([
      {
        id: 'cand2',
        name: 'alice smith',
        branch: 'BLR',
        recruiter: 'recruit.two@company.com',
        expert: 'user.two@company.com',
        technology: 'node js',
        email: 'alice.smith@example.com',
        contact: '222'
      }
    ]);

    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'recruit.two@company.com', role: 'recruiter', teamLead: 'Lead User' }
    ]);
    userService.collectManageableUsers = jest.fn().mockReturnValue([]);

    const result = await candidateService.getCandidatesForUser(
      { email: 'user.two@company.com', role: 'user' },
      {}
    );

    expect(candidateModel.getCandidatesByExperts).toHaveBeenCalledWith(
      ['user.two@company.com'],
      { search: undefined }
    );

    expect(result.scope).toEqual({ type: 'expert', value: ['user.two@company.com'] });
    expect(result.meta).toMatchObject({ experts: ['user.two@company.com'], hasSearch: false });
    expect(result.candidates[0]).toMatchObject({
      name: 'Alice Smith',
      expert: 'User Two',
      expertRaw: 'user.two@company.com',
      recruiter: 'Recruit Two'
    });

    expect(result.options).toEqual(
      expect.objectContaining({
        recruiterChoices: [{ value: 'user.two@company.com', label: 'User Two' }],
        createPolicy: expect.objectContaining({
          canCreate: true
        })
      })
    );
  });

  it('returns combined expert scope for AM including leads and users', async () => {
    candidateModel.getCandidatesByExperts = jest.fn().mockResolvedValue([
      {
        id: 'cand3',
        name: 'steve jones',
        branch: 'GGR',
        recruiter: 'recruit.three@company.com',
        expert: 'lead.alpha@company.com',
        technology: 'python',
        email: 'steve.jones@example.com',
        contact: '333'
      }
    ]);

    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'lead.alpha@company.com', role: 'lead', teamLead: 'Am User' },
      { email: 'lead.beta@company.com', role: 'lead', teamLead: 'Am User' },
      { email: 'user.one@company.com', role: 'user', teamLead: 'Lead Alpha' },
      { email: 'user.two@company.com', role: 'user', teamLead: 'Lead Beta' }
    ]);

    const result = await candidateService.getCandidatesForUser(
      { email: 'am.user@company.com', role: 'AM' },
      { limit: 50 }
    );

    expect(candidateModel.getCandidatesByExperts).toHaveBeenCalledWith(
      expect.arrayContaining([
        'am.user@company.com',
        'lead.alpha@company.com',
        'user.one@company.com',
        'lead.beta@company.com',
        'user.two@company.com'
      ]),
      { search: undefined }
    );

    expect(result.scope).toEqual({
      type: 'expert',
      value: expect.arrayContaining(['am.user@company.com', 'lead.alpha@company.com', 'user.one@company.com', 'lead.beta@company.com', 'user.two@company.com'])
    });

    expect(result.options?.expertChoices).toEqual(
      expect.arrayContaining([
        { value: 'am.user@company.com', label: 'Am User' },
        { value: 'lead.alpha@company.com', label: 'Lead Alpha' },
        { value: 'lead.beta@company.com', label: 'Lead Beta' },
        { value: 'user.one@company.com', label: 'User One' },
        { value: 'user.two@company.com', label: 'User Two' }
      ])
    );
  });
});

describe('candidateService.getCandidatesForUser recruiter scope', () => {
  it('returns recruiter specific candidates', async () => {
    candidateModel.getCandidatesByRecruiters = jest.fn().mockResolvedValue([
      {
        id: 'cand3',
        name: 'mark taylor',
        branch: 'NYC',
        recruiter: 'recruiter.one@company.com',
        expert: '',
        technology: 'python',
        email: 'mark.taylor@example.com',
        contact: '333'
      }
    ]);

    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'recruiter.one@company.com', role: 'recruiter' },
      { email: 'manager.one@company.com', role: 'manager' }
    ]);
    userService.collectManageableUsers = jest.fn().mockReturnValue([]);

    const result = await candidateService.getCandidatesForUser(
      { email: 'recruiter.one@company.com', role: 'recruiter' },
      { limit: 10 }
    );

    const [recruiterEmailsArg, recruiterOptionsArg] = candidateModel.getCandidatesByRecruiters.mock.calls[0];
    expect(recruiterEmailsArg).toEqual(['recruiter.one@company.com']);
    expect(recruiterOptionsArg.search).toBeUndefined();
    expect(recruiterOptionsArg.visibility.recruiterAliases).toEqual(
      expect.arrayContaining([
        'recruiter.one@company.com',
        'recruiter.one',
        'Recruiter One'
      ])
    );
    expect(recruiterOptionsArg.visibility.senderPatterns).toEqual(
      expect.arrayContaining(['recruiter\\.one'])
    );

    expect(result.scope).toEqual({
      type: 'hierarchy',
      value: ['recruiter.one@company.com']
    });

    expect(result.candidates[0]).toMatchObject({
      id: 'cand3',
      name: 'Mark Taylor',
      recruiterRaw: 'recruiter.one@company.com',
      email: 'mark.taylor@example.com'
    });
  });
});

describe('candidateService buildAssignablePeople integration', () => {
  it('returns direct reports and self for MM', async () => {
    candidateModel.getCandidatesByBranch = jest.fn().mockResolvedValue([]);
    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'mam.one@silverspaceinc.com', role: 'MAM', manager: 'Tushar Ahuja' },
      { email: 'mlead.one@silverspaceinc.com', role: 'mlead', manager: 'mam.one@silverspaceinc.com' },
      { email: 'recruit.one@silverspaceinc.com', role: 'recruiter', manager: 'Mam One', teamLead: 'Mlead One' },
      { email: 'mlead.direct@silverspaceinc.com', role: 'mlead', manager: 'Tushar Ahuja' },
      { email: 'recruit.direct@silverspaceinc.com', role: 'recruiter', manager: 'Tushar Ahuja', teamLead: 'Mlead Direct' }
    ]);
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'mam.one@silverspaceinc.com', role: 'mam', active: true },
      { email: 'mlead.direct@silverspaceinc.com', role: 'mlead', active: true },
      { email: 'recruit.direct@silverspaceinc.com', role: 'recruiter', active: true }
    ]);

    const result = await candidateService.getCandidatesForUser(
      { email: 'tushar.ahuja@silverspaceinc.com', role: 'MM' },
      {}
    );

    expect(result.options?.recruiterChoices).toEqual([
      { value: 'mam.one@silverspaceinc.com', label: 'Mam One' },
      { value: 'mlead.direct@silverspaceinc.com', label: 'Mlead Direct' },
      { value: 'recruit.direct@silverspaceinc.com', label: 'Recruit Direct' },
      { value: 'tushar.ahuja@silverspaceinc.com', label: 'Tushar Ahuja' }
    ]);
  });

  it('returns mlead and recruiters plus self for MAM', async () => {
    candidateModel.getCandidatesByRecruiters = jest.fn().mockResolvedValue([]);
    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'mlead.one@silverspaceinc.com', role: 'mlead', manager: 'Mam User' },
      { email: 'recruit.one@silverspaceinc.com', role: 'recruiter', teamLead: 'Mlead One' },
      { email: 'recruit.direct@silverspaceinc.com', role: 'recruiter', teamLead: 'Mam User' },
      { email: 'recruit.two@silverspaceinc.com', role: 'recruiter', teamLead: 'Other Lead' }
    ]);
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'mlead.one@silverspaceinc.com', role: 'mlead', active: true },
      { email: 'recruit.direct@silverspaceinc.com', role: 'recruiter', active: true },
      { email: 'recruit.one@silverspaceinc.com', role: 'recruiter', active: true }
    ]);

    const result = await candidateService.getCandidatesForUser(
      { email: 'mam.user@silverspaceinc.com', role: 'MAM' },
      {}
    );

    const [mamRecruitersArg, mamOptionsArg] = candidateModel.getCandidatesByRecruiters.mock.calls[0];
    expect(mamRecruitersArg).toEqual(
      expect.arrayContaining([
        'recruit.direct@silverspaceinc.com',
        'mam.user@silverspaceinc.com'
      ])
    );
    expect(mamOptionsArg.visibility.senderPatterns).toEqual(
      expect.arrayContaining(['mam\\.user'])
    );

    expect(result.options?.recruiterChoices).toEqual([
      { value: 'mam.user@silverspaceinc.com', label: 'Mam User' },
      { value: 'mlead.one@silverspaceinc.com', label: 'Mlead One' },
      { value: 'recruit.direct@silverspaceinc.com', label: 'Recruit Direct' },
      { value: 'recruit.one@silverspaceinc.com', label: 'Recruit One' }
    ]);
  });

  it('returns recruiters and self for MLEAD', async () => {
    candidateModel.getCandidatesByRecruiters = jest.fn().mockResolvedValue([]);
    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'recruit.one@silverspaceinc.com', role: 'recruiter', teamLead: 'Mlead One' },
      { email: 'recruit.two@silverspaceinc.com', role: 'recruiter', teamLead: 'Another Lead' }
    ]);
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruit.one@silverspaceinc.com', role: 'recruiter', active: true }
    ]);

    const result = await candidateService.getCandidatesForUser(
      { email: 'mlead.one@silverspaceinc.com', role: 'mlead' },
      {}
    );

    const [mleadRecruitersArg, mleadOptionsArg] = candidateModel.getCandidatesByRecruiters.mock.calls[0];
    expect(new Set(mleadRecruitersArg)).toEqual(new Set([
      'recruit.one@silverspaceinc.com',
      'mlead.one@silverspaceinc.com'
    ]));
    expect(mleadOptionsArg.visibility.senderPatterns).toEqual(
      expect.arrayContaining(['mlead\\.one'])
    );

    expect(result.options?.recruiterChoices).toEqual([
      { value: 'mlead.one@silverspaceinc.com', label: 'Mlead One' },
      { value: 'recruit.one@silverspaceinc.com', label: 'Recruit One' }
    ]);
  });
});

describe('candidateService.buildRecruiterVisibility', () => {
  it('creates aliases and patterns for recruiters and requestor', () => {
    const visibility = candidateService.buildRecruiterVisibility(
      ['recruit.alpha@example.com'],
      { email: 'mam.user@silverspaceinc.com' }
    );

    expect(visibility.recruiterAliases).toEqual(
      expect.arrayContaining([
        'recruit.alpha@example.com',
        'recruit.alpha',
        'Recruit Alpha'
      ])
    );

    expect(visibility.senderPatterns).toEqual(
      expect.arrayContaining(['mam\\.user', 'mam\\.user@silverspaceinc\\.com'])
    );

    expect(visibility.ccPatterns).toEqual(
      expect.arrayContaining(['mam\\.user', 'mam\\.user@silverspaceinc\\.com'])
    );
  });
});
