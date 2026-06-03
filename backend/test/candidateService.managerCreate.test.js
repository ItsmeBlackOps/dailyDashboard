import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { candidateModel, WORKFLOW_STATUS, RESUME_UNDERSTANDING_STATUS } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';
import { userService } from '../src/services/userService.js';

const SAMPLE_RESUME_LINK = 'https://egvjgtfjstxgszpzvvbx.supabase.co/storage/v1/object/public/resumes/sample.pdf';

const originalCreateCandidate = candidateModel.createCandidate;
const originalCount = candidateModel.countResumeUnderstandingTasks;
const originalGetByWorkflow = candidateModel.getCandidatesByWorkflowStatus;
const originalCountByWorkflow = candidateModel.countCandidatesByWorkflowStatuses;
const originalGetCandidateById = candidateModel.getCandidateById;
const originalGetCandidateByEmail = candidateModel.getCandidateByEmail;
const originalUpdateResume = candidateModel.updateResumeUnderstandingStatus;
const originalGetAllUsers = userModel.getAllUsers;
const originalGetUserByEmail = userModel.getUserByEmail;
const originalCollectManageableUsers = userService.collectManageableUsers;

afterEach(() => {
  candidateModel.createCandidate = originalCreateCandidate;
  candidateModel.countResumeUnderstandingTasks = originalCount;
  candidateModel.getCandidatesByWorkflowStatus = originalGetByWorkflow;
  candidateModel.countCandidatesByWorkflowStatuses = originalCountByWorkflow;
  candidateModel.getCandidateById = originalGetCandidateById;
  candidateModel.getCandidateByEmail = originalGetCandidateByEmail;
  candidateModel.updateResumeUnderstandingStatus = originalUpdateResume;
  userModel.getAllUsers = originalGetAllUsers;
  userModel.getUserByEmail = originalGetUserByEmail;
  userService.collectManageableUsers = originalCollectManageableUsers;
  jest.restoreAllMocks();
});

beforeEach(() => {
  // Duplicate guard default: no existing candidate with the email, so the
  // guard passes and create proceeds. Tests that exercise the 409 path
  // override this with a returned candidate.
  candidateModel.getCandidateByEmail = jest.fn().mockResolvedValue(null);
});

describe('candidateService manager create flow', () => {
  it('forces expert to remain empty and sets awaiting workflow', async () => {
    const now = new Date();
    candidateModel.createCandidate = jest.fn().mockResolvedValue({
      _id: { toString: () => 'abc123' },
      Branch: 'GGR',
      Recruiter: 'recruiter@example.com',
      Expert: '',
      Technology: 'React',
      'Candidate Name': 'Jane Doe',
      'Email ID': 'jane.doe@example.com',
      'Contact No': '12345',
      resumeLink: SAMPLE_RESUME_LINK,
      workflowStatus: WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
      createdBy: 'manager@example.com',
      updated_at: now,
      _last_write: now
    });

    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter' }
    ]);
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter', active: true }
    ]);

    const result = await candidateService.createCandidateFromManager(
      { email: 'manager@example.com', role: 'manager' },
      {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        technology: 'react',
        branch: 'ggr',
        recruiter: 'recruiter@example.com',
        // PRT Phase 1 requires a teamLead (derived from the recruiter or
        // supplied explicitly). Supplied here so the create proceeds.
        teamLead: 'tlead@example.com',
        expert: 'should@not.persist',
        resumeLink: SAMPLE_RESUME_LINK,
        // SP1: marketing info is now hard-required at creation.
        visaType: 'H1B',
        company: 'SST',
        experienceYears: 5,
        city: 'Ahmedabad',
        state: 'Gujarat'
      }
    );

    // objectContaining: PRT Phase 1 also stamps status/ackEmail/marketing
    // defaults onto the create payload — assert the fields this test cares
    // about without pinning the full PRT surface.
    expect(candidateModel.createCandidate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jane Doe',
      email: 'jane.doe@example.com',
      technology: 'React',
      branch: 'GGR',
      recruiter: 'recruiter@example.com',
      teamLead: 'tlead@example.com',
      resumeLink: SAMPLE_RESUME_LINK,
      expert: '',
      workflowStatus: WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
      createdBy: 'manager@example.com',
      status: 'New',
      ackEmail: 'Pending'
    }));

    expect(result.workflowStatus).toBe(WORKFLOW_STATUS.awaitingExpert);
    expect(result.expertRaw).toBe('');
    expect(result.createdBy).toBe('manager@example.com');
  });

  it('rejects creating a candidate whose email already exists (409, no insert)', async () => {
    candidateModel.createCandidate = jest.fn();
    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter' }
    ]);
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter', active: true }
    ]);
    // An active candidate with the same email already exists.
    candidateModel.getCandidateByEmail = jest.fn().mockResolvedValue({
      id: 'existing-1',
      name: 'Vrishin Reddy Minkuri',
      email: 'vrishin.min@gmail.com',
      recruiter: 'recruiter@example.com'
    });

    await expect(candidateService.createCandidateFromManager(
      { email: 'manager@example.com', role: 'manager' },
      {
        name: 'Vrishin Reddy Minkuri',
        email: 'vrishin.min@gmail.com',
        technology: 'software developer',
        branch: 'ahm',
        recruiter: 'recruiter@example.com',
        teamLead: 'tlead@example.com',
        resumeLink: SAMPLE_RESUME_LINK,
        // SP1: marketing info is now hard-required at creation.
        visaType: 'H1B',
        company: 'SST',
        experienceYears: 5,
        city: 'Ahmedabad',
        state: 'Gujarat'
      }
    )).rejects.toMatchObject({ statusCode: 409 });

    expect(candidateModel.getCandidateByEmail).toHaveBeenCalledWith('vrishin.min@gmail.com');
    // The duplicate must never be inserted.
    expect(candidateModel.createCandidate).not.toHaveBeenCalled();
  });

  it('allows MM to submit candidate with normalized contact', async () => {
    const now = new Date();
    candidateModel.createCandidate = jest.fn().mockResolvedValue({
      _id: { toString: () => 'mm123' },
      Branch: 'GGR',
      Recruiter: 'recruiter@example.com',
      Expert: '',
      Technology: 'React',
      'Candidate Name': 'Jane Doe',
      'Email ID': 'jane.doe@example.com',
      'Contact No': '+11234567890',
      resumeLink: SAMPLE_RESUME_LINK,
      workflowStatus: WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
      createdBy: 'mm.user@company.com',
      updated_at: now,
      _last_write: now
    });

    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter' }
    ]);
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter', active: true }
    ]);

    const result = await candidateService.createCandidateFromManager(
      { email: 'mm.user@company.com', role: 'MM' },
      {
        name: 'jane doe',
        email: 'JANE.DOE@EXAMPLE.COM',
        technology: 'react',
        branch: 'ggr',
        recruiter: 'recruiter@example.com',
        teamLead: 'tlead@example.com',
        contact: '(123) 456-7890',
        resumeLink: SAMPLE_RESUME_LINK,
        // SP1: marketing info is now hard-required at creation.
        visaType: 'H1B',
        company: 'SST',
        experienceYears: 5,
        city: 'Ahmedabad',
        state: 'Gujarat'
      }
    );

    expect(candidateModel.createCandidate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jane Doe',
      email: 'jane.doe@example.com',
      technology: 'React',
      branch: 'GGR',
      recruiter: 'recruiter@example.com',
      teamLead: 'tlead@example.com',
      contact: '+11234567890',
      resumeLink: SAMPLE_RESUME_LINK,
      expert: '',
      workflowStatus: WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
      createdBy: 'mm.user@company.com',
      // PRT defaults stamped on create
      status: 'New',
      ackEmail: 'Pending'
    }));

    expect(result.createdBy).toBe('mm.user@company.com');
  });

  it('rejects candidate creation when resume link is missing', async () => {
    await expect(
      candidateService.createCandidateFromManager(
        { email: 'manager@example.com', role: 'manager' },
        {
          name: 'Jane Doe',
          email: 'jane.doe@example.com',
          technology: 'react',
          branch: 'ggr',
          recruiter: 'recruiter@example.com'
        }
      )
    ).rejects.toThrow('Resume link is required');
  });

  it('forces MAM branch from MM mapping even when payload branch is tampered', async () => {
    const now = new Date();
    candidateModel.createCandidate = jest.fn().mockResolvedValue({
      _id: { toString: () => 'mam123' },
      Branch: 'GGR',
      Recruiter: 'recruiter@example.com',
      Expert: '',
      Technology: 'React',
      'Candidate Name': 'Jane Doe',
      'Email ID': 'jane.doe@example.com',
      'Contact No': '12345',
      resumeLink: SAMPLE_RESUME_LINK,
      workflowStatus: WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
      createdBy: 'mam.user@company.com',
      updated_at: now,
      _last_write: now
    });

    userModel.getUserByEmail = jest.fn((email) => {
      const normalized = String(email || '').toLowerCase();
      if (normalized === 'mam.user@company.com') {
        return {
          email: 'mam.user@company.com',
          role: 'mam',
          manager: 'tushar.ahuja@silverspaceinc.com',
          active: true
        };
      }
      if (normalized === 'tushar.ahuja@silverspaceinc.com') {
        return {
          email: 'tushar.ahuja@silverspaceinc.com',
          role: 'mm',
          active: true
        };
      }
      return null;
    });

    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter', active: true }
    ]);

    await candidateService.createCandidateFromManager(
      { email: 'mam.user@company.com', role: 'MAM' },
      {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        technology: 'react',
        branch: 'LKN',
        recruiter: 'recruiter@example.com',
        teamLead: 'tlead@example.com',
        resumeLink: SAMPLE_RESUME_LINK,
        // SP1: marketing info is now hard-required at creation.
        visaType: 'H1B',
        company: 'SST',
        experienceYears: 5,
        city: 'Ahmedabad',
        state: 'Gujarat'
      }
    );

    expect(candidateModel.createCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: 'GGR'
      })
    );
  });

  it('resolves MAM branch when the MM has the post-C20 role "manager" (not legacy "mm")', async () => {
    const now = new Date();
    candidateModel.createCandidate = jest.fn().mockResolvedValue({
      _id: { toString: () => 'mam124' },
      Branch: 'GGR',
      Recruiter: 'recruiter@example.com',
      Expert: '',
      Technology: 'React',
      'Candidate Name': 'Jane Doe',
      'Email ID': 'jane.doe@example.com',
      'Contact No': '12345',
      resumeLink: SAMPLE_RESUME_LINK,
      workflowStatus: WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
      createdBy: 'mam.user@company.com',
      updated_at: now,
      _last_write: now
    });

    // Post-migration shape: MAM is stored as assistantManager+marketing, and
    // the MM (Tushar) now carries the new role name 'manager', not 'mm'.
    userModel.getUserByEmail = jest.fn((email) => {
      const normalized = String(email || '').toLowerCase();
      if (normalized === 'mam.user@company.com') {
        return {
          email: 'mam.user@company.com',
          role: 'assistantManager',
          team: 'marketing',
          manager: 'tushar.ahuja@silverspaceinc.com',
          active: true
        };
      }
      if (normalized === 'tushar.ahuja@silverspaceinc.com') {
        return {
          email: 'tushar.ahuja@silverspaceinc.com',
          role: 'manager',
          team: 'marketing',
          active: true
        };
      }
      return null;
    });

    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter', active: true }
    ]);

    // Requester role is the auth-translated legacy form ('MAM').
    await candidateService.createCandidateFromManager(
      { email: 'mam.user@company.com', role: 'MAM' },
      {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        technology: 'react',
        branch: 'LKN',
        recruiter: 'recruiter@example.com',
        teamLead: 'tlead@example.com',
        resumeLink: SAMPLE_RESUME_LINK,
        // SP1: marketing info is now hard-required at creation.
        visaType: 'H1B',
        company: 'SST',
        experienceYears: 5,
        city: 'Ahmedabad',
        state: 'Gujarat'
      }
    );

    expect(candidateModel.createCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: 'GGR'
      })
    );
  });

  it('blocks MAM creation when MM mapping is missing', async () => {
    userModel.getUserByEmail = jest.fn((email) => {
      const normalized = String(email || '').toLowerCase();
      if (normalized === 'mam.user@company.com') {
        return {
          email: 'mam.user@company.com',
          role: 'mam',
          manager: 'unknown.mm@silverspaceinc.com',
          active: true
        };
      }
      return null;
    });
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter', active: true }
    ]);

    await expect(
      candidateService.createCandidateFromManager(
        { email: 'mam.user@company.com', role: 'MAM' },
        {
          name: 'Jane Doe',
          email: 'jane.doe@example.com',
          technology: 'react',
          branch: 'GGR',
          recruiter: 'recruiter@example.com',
          resumeLink: SAMPLE_RESUME_LINK
        }
      )
    ).rejects.toThrow('MAM to MM mapping is missing');
  });

  it('rejects invalid branch values across create API', async () => {
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter', active: true }
    ]);

    await expect(
      candidateService.createCandidateFromManager(
        { email: 'manager@example.com', role: 'manager' },
        {
          name: 'Jane Doe',
          email: 'jane.doe@example.com',
          technology: 'react',
          branch: 'XYZ',
          recruiter: 'recruiter@example.com',
          resumeLink: SAMPLE_RESUME_LINK
        }
      )
    ).rejects.toThrow('Branch must be one of GGR, LKN, AHM');
  });

  it('rejects recruiter outside active hierarchy scope', async () => {
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'inactive.recruiter@example.com', role: 'recruiter', active: false }
    ]);

    await expect(
      candidateService.createCandidateFromManager(
        { email: 'manager@example.com', role: 'manager' },
        {
          name: 'Jane Doe',
          email: 'jane.doe@example.com',
          technology: 'react',
          branch: 'GGR',
          recruiter: 'recruiter@example.com',
          resumeLink: SAMPLE_RESUME_LINK
        }
      )
    ).rejects.toThrow('Recruiter must be an active user in your hierarchy or yourself');
  });

  it('returns recruiter choices for active hierarchy users plus self only', () => {
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'active.one@example.com', active: true, role: 'recruiter' },
      { email: 'inactive.one@example.com', active: false, role: 'recruiter' }
    ]);
    userModel.getUserByEmail = jest.fn().mockReturnValue({
      email: 'mam.user@company.com',
      role: 'mam',
      active: true
    });

    const choices = candidateService.buildAssignablePeople({
      email: 'mam.user@company.com',
      role: 'MAM'
    });

    expect(choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'active.one@example.com' }),
        expect.objectContaining({ value: 'mam.user@company.com' })
      ])
    );
    expect(choices.find((entry) => entry.value === 'inactive.one@example.com')).toBeUndefined();
  });
});

describe('candidateService resume understanding helpers', () => {
  it('counts pending queue for experts via optimized query', async () => {
    candidateModel.countResumeUnderstandingTasks = jest.fn().mockResolvedValue(5);

    const count = await candidateService.getResumeUnderstandingCount(
      { email: 'expert@example.com', role: 'expert' }
    );

    expect(candidateModel.countResumeUnderstandingTasks).toHaveBeenCalledWith('expert@example.com', RESUME_UNDERSTANDING_STATUS.pending);
    expect(count).toBe(5);
  });

  it('counts completed queue for admins via countDocuments on workflow status', async () => {
    // Counts through the dedicated count primitive (countDocuments) rather
    // than fetching + mapping the whole queue just to read .length.
    candidateModel.countCandidatesByWorkflowStatuses = jest.fn().mockResolvedValue(3);

    const count = await candidateService.getResumeUnderstandingCount(
      { email: 'admin@example.com', role: 'admin' },
      RESUME_UNDERSTANDING_STATUS.done
    );

    expect(candidateModel.countCandidatesByWorkflowStatuses).toHaveBeenCalledWith(
      [WORKFLOW_STATUS.completed]
    );
    expect(count).toBe(3);
  });

  it('updates resume understanding status when requester is assigned expert', async () => {
    const now = new Date();
    candidateModel.getCandidateById = jest.fn().mockResolvedValue({
      id: 'cand-1',
      expert: 'expert@example.com'
    });

    candidateModel.updateResumeUnderstandingStatus = jest.fn().mockResolvedValue({
      _id: { toString: () => 'cand-1' },
      Branch: 'GGR',
      Recruiter: 'recruiter@example.com',
      Expert: 'expert@example.com',
      Technology: 'React',
      'Candidate Name': 'Jane Doe',
      'Email ID': 'jane.doe@example.com',
      'Contact No': '12345',
      workflowStatus: WORKFLOW_STATUS.completed,
      resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.done,
      createdBy: 'manager@example.com',
      updated_at: now,
      _last_write: now
    });

    const result = await candidateService.updateResumeUnderstanding(
      { email: 'expert@example.com', role: 'expert' },
      'cand-1',
      RESUME_UNDERSTANDING_STATUS.done
    );

    expect(candidateModel.getCandidateById).toHaveBeenCalledWith('cand-1');
    expect(candidateModel.updateResumeUnderstandingStatus).toHaveBeenCalledWith('cand-1', RESUME_UNDERSTANDING_STATUS.done);
    expect(result.resumeUnderstandingStatus).toBe(RESUME_UNDERSTANDING_STATUS.done);
    expect(result.workflowStatus).toBe(WORKFLOW_STATUS.completed);
  });
});
