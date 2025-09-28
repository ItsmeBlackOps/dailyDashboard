import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { candidateModel, WORKFLOW_STATUS, RESUME_UNDERSTANDING_STATUS } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';

const originalCreateCandidate = candidateModel.createCandidate;
const originalCount = candidateModel.countResumeUnderstandingTasks;
const originalGetByWorkflow = candidateModel.getCandidatesByWorkflowStatus;
const originalGetCandidateById = candidateModel.getCandidateById;
const originalUpdateResume = candidateModel.updateResumeUnderstandingStatus;
const originalAssignExpert = candidateModel.assignExpertById;
const originalGetAllUsers = userModel.getAllUsers;

afterEach(() => {
  candidateModel.createCandidate = originalCreateCandidate;
  candidateModel.countResumeUnderstandingTasks = originalCount;
  candidateModel.getCandidatesByWorkflowStatus = originalGetByWorkflow;
  candidateModel.getCandidateById = originalGetCandidateById;
  candidateModel.updateResumeUnderstandingStatus = originalUpdateResume;
  candidateModel.assignExpertById = originalAssignExpert;
  userModel.getAllUsers = originalGetAllUsers;
  jest.restoreAllMocks();
});

describe('candidateService managerial access guards', () => {
  it('allows MM roles to fetch pending expert assignments', async () => {
    candidateModel.getCandidatesByWorkflowStatus = jest.fn().mockResolvedValue([]);
    userModel.getAllUsers = jest.fn().mockReturnValue([]);

    const result = await candidateService.getPendingExpertAssignments({
      email: 'mm.lead@example.com',
      role: 'MM'
    });

    expect(candidateModel.getCandidatesByWorkflowStatus).toHaveBeenCalled();
    expect(result.candidates).toEqual([]);
  });

  it('permits MM roles to assign experts', async () => {
    candidateModel.assignExpertById = jest.fn().mockResolvedValue({
      _id: { toString: () => 'cand-123' },
      expert: 'lead@example.com',
      email: 'candidate@example.com'
    });

    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'lead@example.com', role: 'lead' }
    ]);

    const result = await candidateService.assignExpert(
      { email: 'mm.manager@example.com', role: 'MM' },
      'cand-123',
      'lead@example.com'
    );

    expect(candidateModel.assignExpertById).toHaveBeenCalledWith('cand-123', 'lead@example.com');
    expect(result.expertRaw).toBe('lead@example.com');
  });

  it('rejects non-manager roles from pending expert view', async () => {
    await expect(
      candidateService.getPendingExpertAssignments({ email: 'lead@example.com', role: 'lead' })
    ).rejects.toThrow('Access denied');
  });
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
      workflowStatus: WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
      createdBy: 'manager@example.com',
      updated_at: now,
      _last_write: now
    });

    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter' }
    ]);

    const result = await candidateService.createCandidateFromManager(
      { email: 'manager@example.com', role: 'manager' },
      {
        name: 'Jane Doe',
        email: 'jane.doe@example.com',
        technology: 'react',
        branch: 'ggr',
        recruiter: 'recruiter@example.com',
        expert: 'should@not.persist'
      }
    );

    expect(candidateModel.createCandidate).toHaveBeenCalledWith({
      name: 'Jane Doe',
      email: 'jane.doe@example.com',
      technology: 'React',
      branch: 'GGR',
      recruiter: 'recruiter@example.com',
      expert: '',
      workflowStatus: WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
      createdBy: 'manager@example.com'
    });

    expect(result.workflowStatus).toBe(WORKFLOW_STATUS.awaitingExpert);
    expect(result.expertRaw).toBe('');
    expect(result.createdBy).toBe('manager@example.com');
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
      workflowStatus: WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
      createdBy: 'mm.user@company.com',
      updated_at: now,
      _last_write: now
    });

    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'recruiter@example.com', role: 'recruiter' }
    ]);

    const result = await candidateService.createCandidateFromManager(
      { email: 'mm.user@company.com', role: 'MM' },
      {
        name: 'jane doe',
        email: 'JANE.DOE@EXAMPLE.COM',
        technology: 'react',
        branch: 'ggr',
        recruiter: 'recruiter@example.com',
        contact: '(123) 456-7890'
      }
    );

    expect(candidateModel.createCandidate).toHaveBeenCalledWith({
      name: 'Jane Doe',
      email: 'jane.doe@example.com',
      technology: 'React',
      branch: 'GGR',
      recruiter: 'recruiter@example.com',
      contact: '+11234567890',
      expert: '',
      workflowStatus: WORKFLOW_STATUS.awaitingExpert,
      resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
      createdBy: 'mm.user@company.com'
    });

    expect(result.createdBy).toBe('mm.user@company.com');
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

  it('counts completed queue for admins using workflow status', async () => {
    candidateModel.getCandidatesByWorkflowStatus = jest.fn().mockResolvedValue([{}, {}, {}]);

    const count = await candidateService.getResumeUnderstandingCount(
      { email: 'admin@example.com', role: 'admin' },
      RESUME_UNDERSTANDING_STATUS.done
    );

    expect(candidateModel.getCandidatesByWorkflowStatus).toHaveBeenCalledWith(
      WORKFLOW_STATUS.completed,
      { limit: 500 }
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
