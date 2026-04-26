import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { candidateModel, WORKFLOW_STATUS, RESUME_UNDERSTANDING_STATUS } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';

const originalGetByWorkflow = candidateModel.getCandidatesByWorkflowStatus;
const originalAssignExpert = candidateModel.assignExpertById;
const originalGetAllUsers = userModel.getAllUsers;

afterEach(() => {
  candidateModel.getCandidatesByWorkflowStatus = originalGetByWorkflow;
  candidateModel.assignExpertById = originalAssignExpert;
  userModel.getAllUsers = originalGetAllUsers;
  jest.restoreAllMocks();
});

describe('candidateService.getPendingExpertAssignments', () => {
  it('returns formatted candidates with roster expert choices for admins', async () => {
    candidateModel.getCandidatesByWorkflowStatus = jest.fn().mockResolvedValue([
      {
        id: 'cand-1',
        name: 'jane doe',
        branch: 'GGR',
        recruiter: 'recruiter@example.com',
        recruiterRaw: 'recruiter@example.com',
        expert: '',
        expertRaw: '',
        technology: 'react',
        email: 'jane.doe@example.com',
        contact: '12345',
        workflowStatus: WORKFLOW_STATUS.awaitingExpert,
        resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
        createdBy: 'manager@example.com'
      }
    ]);

    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'am.user@example.com', role: 'AM' },
      { email: 'lead.user@example.com', role: 'Lead' },
      { email: 'expert.role@example.com', role: 'EXPERT' },
      { email: 'viewer@example.com', role: 'viewer' }
    ]);

    const result = await candidateService.getPendingExpertAssignments(
      { email: 'admin@example.com', role: 'admin' },
      { limit: 50 }
    );

    expect(candidateModel.getCandidatesByWorkflowStatus).toHaveBeenCalledWith(
      [WORKFLOW_STATUS.awaitingExpert, WORKFLOW_STATUS.needsResumeUnderstanding]
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: 'cand-1',
      name: 'Jane Doe',
      recruiter: 'Recruiter',
      recruiterRaw: 'recruiter@example.com',
      resumeUnderstanding: false
    });

    expect(result.options?.expertChoices).toEqual(
      expect.arrayContaining([
        { value: 'am.user@example.com', label: 'Am User' },
        { value: 'lead.user@example.com', label: 'Lead User' },
        { value: 'expert.role@example.com', label: 'Expert Role' }
      ])
    );
  });
});

describe('candidateService.assignExpert roster validation', () => {
  it('rejects expert assignment when email is not on roster', async () => {
    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'lead.user@example.com', role: 'Lead' }
    ]);

    await expect(
      candidateService.assignExpert(
        { email: 'admin@example.com', role: 'admin' },
        'cand-1',
        'not.rostered@example.com'
      )
    ).rejects.toThrow('Expert must be selected from the roster');
  });

  it('assigns expert when email is on roster', async () => {
    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'lead.user@example.com', role: 'Lead' }
    ]);

    candidateModel.assignExpertById = jest.fn().mockResolvedValue({
      id: 'cand-1',
      name: 'Jane Doe',
      branch: 'GGR',
      recruiter: 'Recruiter',
      expert: 'lead.user@example.com',
      technology: 'React',
      email: 'jane.doe@example.com',
      contact: '',
      workflowStatus: WORKFLOW_STATUS.needsResumeUnderstanding,
      resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending
    });

    const result = await candidateService.assignExpert(
      { email: 'admin@example.com', role: 'admin' },
      'cand-1',
      'lead.user@example.com'
    );

    expect(candidateModel.assignExpertById).toHaveBeenCalledWith('cand-1', 'lead.user@example.com');
    expect(result.expertRaw).toBe('lead.user@example.com');
  });
});
