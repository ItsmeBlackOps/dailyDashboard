import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { candidateModel, WORKFLOW_STATUS, RESUME_UNDERSTANDING_STATUS } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';

const originalGetAllCandidates = candidateModel.getAllCandidates;
const originalGetAllUsers = userModel.getAllUsers;

afterEach(() => {
  candidateModel.getAllCandidates = originalGetAllCandidates;
  userModel.getAllUsers = originalGetAllUsers;
  jest.restoreAllMocks();
});

describe('candidateService admin visibility', () => {
  it('returns global candidate list for admins with roster metadata', async () => {
    candidateModel.getAllCandidates = jest.fn().mockResolvedValue([
      {
        id: 'cand-1',
        name: 'jane doe',
        branch: 'GGR',
        recruiter: 'recruiter@example.com',
        expert: 'expert@example.com',
        technology: 'react',
        email: 'jane.doe@example.com',
        contact: '+11234567890',
        workflowStatus: WORKFLOW_STATUS.awaitingExpert,
        resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending,
        createdBy: 'manager@example.com'
      }
    ]);

    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'mam@example.com', role: 'MAM' },
      { email: 'mlead@example.com', role: 'mLEAD', manager: 'mam@example.com' },
      { email: 'recruiter@example.com', role: 'recruiter', manager: 'mlead@example.com' },
      { email: 'am@example.com', role: 'AM' },
      { email: 'lead@example.com', role: 'Lead', teamLead: 'AM Example' },
      { email: 'user@example.com', role: 'User', teamLead: 'Lead Example' },
      { email: 'expert@example.com', role: 'Expert' }
    ]);

    const result = await candidateService.getCandidatesForUser(
      { email: 'admin@example.com', role: 'admin' },
      { limit: 150, search: 'Jane' }
    );

    expect(candidateModel.getAllCandidates).toHaveBeenCalledWith({
      search: 'Jane'
    });

    expect(result.scope).toEqual({ type: 'admin', value: 'all' });
    expect(result.meta.count).toBe(1);
    expect(result.meta.hasSearch).toBe(true);

    expect(result.candidates[0]).toMatchObject({
      id: 'cand-1',
      name: 'Jane Doe',
      recruiterRaw: 'recruiter@example.com',
      recruiter: 'Recruiter',
      expertRaw: 'expert@example.com',
      expert: 'Expert',
      email: 'jane.doe@example.com',
      technology: 'React'
    });

    expect(result.options?.recruiterChoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'mam@example.com' }),
        expect.objectContaining({ value: 'recruiter@example.com' })
      ])
    );

    expect(result.options?.expertChoices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'expert@example.com' }),
        expect.objectContaining({ value: 'lead@example.com' })
      ])
    );
  });
});
