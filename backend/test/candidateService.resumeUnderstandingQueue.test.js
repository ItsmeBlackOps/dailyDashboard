import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { candidateModel, RESUME_UNDERSTANDING_STATUS, WORKFLOW_STATUS } from '../src/models/Candidate.js';
import { userModel } from '../src/models/User.js';

const originalGetCandidatesForExpert = candidateModel.getCandidatesForExpert;
const originalGetCandidatesByExperts = candidateModel.getCandidatesByExperts;
const originalCountTasks = candidateModel.countResumeUnderstandingTasks;
const originalCountTasksForExperts = candidateModel.countResumeUnderstandingTasksForExperts;
const originalCountByWorkflowStatuses = candidateModel.countCandidatesByWorkflowStatuses;
const originalGetCandidatesByRecruiters = candidateModel.getCandidatesByRecruiters;
const originalCountCandidatesByRecruiters = candidateModel.countCandidatesByRecruiters;
const originalGetTeamEmails = userModel.getTeamEmails;
const originalGetUserByEmail = userModel.getUserByEmail;
const originalGetAllUsers = userModel.getAllUsers;

afterEach(() => {
  candidateModel.getCandidatesForExpert = originalGetCandidatesForExpert;
  candidateModel.getCandidatesByExperts = originalGetCandidatesByExperts;
  candidateModel.countResumeUnderstandingTasks = originalCountTasks;
  candidateModel.countResumeUnderstandingTasksForExperts = originalCountTasksForExperts;
  candidateModel.countCandidatesByWorkflowStatuses = originalCountByWorkflowStatuses;
  candidateModel.getCandidatesByRecruiters = originalGetCandidatesByRecruiters;
  candidateModel.countCandidatesByRecruiters = originalCountCandidatesByRecruiters;
  userModel.getTeamEmails = originalGetTeamEmails;
  userModel.getUserByEmail = originalGetUserByEmail;
  userModel.getAllUsers = originalGetAllUsers;
  jest.restoreAllMocks();
});

describe('candidateService resume understanding visibility', () => {
  it('includes team assignments for lead resume understanding queue', async () => {
    candidateModel.getCandidatesByExperts = jest.fn().mockResolvedValue([
      {
        id: 'cand-1',
        name: 'jane doe',
        branch: 'DEL',
        recruiter: 'recruiter@example.com',
        expert: 'user.one@example.com',
        technology: 'node js',
        email: 'jane.doe@example.com',
        contact: '1234567890'
      }
    ]);

    userModel.getTeamEmails = jest.fn().mockReturnValue([
      'lead.manager@example.com',
      'user.one@example.com'
    ]);

    const result = await candidateService.getResumeUnderstandingQueue(
      { email: 'lead.manager@example.com', role: 'lead' },
      RESUME_UNDERSTANDING_STATUS.pending
    );

    expect(userModel.getTeamEmails).toHaveBeenCalledWith(
      'lead.manager@example.com',
      'lead',
      undefined
    );

    expect(candidateModel.getCandidatesByExperts).toHaveBeenCalledWith(
      ['lead.manager@example.com', 'user.one@example.com'],
      { status: RESUME_UNDERSTANDING_STATUS.pending, limit: undefined }
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'cand-1',
      name: 'Jane Doe',
      expertRaw: 'user.one@example.com',
      branch: 'DEL'
    });
  });

  it('aggregates pending counts for lead across team', async () => {
    candidateModel.countResumeUnderstandingTasksForExperts = jest.fn().mockResolvedValue(5);
    userModel.getTeamEmails = jest.fn().mockReturnValue([
      'lead.manager@example.com',
      'user.one@example.com',
      'user.two@example.com'
    ]);

    const count = await candidateService.getResumeUnderstandingCount(
      { email: 'lead.manager@example.com', role: 'lead' },
      RESUME_UNDERSTANDING_STATUS.pending
    );

    expect(candidateModel.countResumeUnderstandingTasksForExperts).toHaveBeenCalledWith(
      ['lead.manager@example.com', 'user.one@example.com', 'user.two@example.com'],
      RESUME_UNDERSTANDING_STATUS.pending
    );
    expect(count).toBe(5);
  });

  it('includes lead watcher for resume understanding updates', () => {
    userModel.getUserByEmail = jest.fn().mockReturnValue({
      teamLead: 'Lead Manager'
    });

    userModel.getAllUsers = jest.fn().mockReturnValue([
      { email: 'lead.manager@example.com', role: 'lead' },
      { email: 'other.lead@example.com', role: 'lead' }
    ]);

    const watchers = candidateService.resolveResumeUnderstandingWatchers('user.one@example.com');

    expect(watchers).toEqual(expect.arrayContaining([
      'user.one@example.com',
      'lead.manager@example.com'
    ]));
    expect(watchers.length).toBe(2);
  });

  it('calculates pending assignment count for admin users', async () => {
    candidateModel.countCandidatesByWorkflowStatuses = jest.fn().mockResolvedValue(7);

    const count = await candidateService.getPendingExpertAssignmentCount(
      { email: 'admin@example.com', role: 'admin' }
    );

    expect(candidateModel.countCandidatesByWorkflowStatuses).toHaveBeenCalledWith([
      WORKFLOW_STATUS.awaitingExpert,
      WORKFLOW_STATUS.needsResumeUnderstanding
    ]);

    expect(count).toBe(7);
  });

  it('counts recruiter queue via countCandidatesByRecruiters without materialising the list', async () => {
    candidateModel.countCandidatesByRecruiters = jest.fn().mockResolvedValue(4);
    // Must NOT fetch + map the whole queue just to read .length.
    candidateModel.getCandidatesByRecruiters = jest.fn().mockResolvedValue([]);

    const count = await candidateService.getResumeUnderstandingCount(
      { email: 'Recruiter.One@Example.com', role: 'recruiter' },
      RESUME_UNDERSTANDING_STATUS.pending
    );

    expect(candidateModel.getCandidatesByRecruiters).not.toHaveBeenCalled();
    expect(candidateModel.countCandidatesByRecruiters).toHaveBeenCalledTimes(1);
    const [emailsArg, optsArg] = candidateModel.countCandidatesByRecruiters.mock.calls[0];
    expect(emailsArg).toEqual(['recruiter.one@example.com']);
    expect(optsArg).toMatchObject({ resumeUnderstandingStatus: RESUME_UNDERSTANDING_STATUS.pending });
    expect(optsArg.visibility).toBeDefined();
    expect(count).toBe(4);
  });

  it('counts with the SAME recruiter scope the queue fetches (badge == page)', async () => {
    candidateModel.getCandidatesByRecruiters = jest.fn().mockResolvedValue([]);
    candidateModel.countCandidatesByRecruiters = jest.fn().mockResolvedValue(0);
    const user = { email: 'Recruiter.One@Example.com', role: 'recruiter' };

    await candidateService.getResumeUnderstandingQueue(user, RESUME_UNDERSTANDING_STATUS.pending);
    await candidateService.getResumeUnderstandingCount(user, RESUME_UNDERSTANDING_STATUS.pending);

    const queueEmails = candidateModel.getCandidatesByRecruiters.mock.calls[0][0];
    const countEmails = candidateModel.countCandidatesByRecruiters.mock.calls[0][0];
    expect(countEmails).toEqual(queueEmails);

    const queueVisibility = candidateModel.getCandidatesByRecruiters.mock.calls[0][1].visibility;
    const countVisibility = candidateModel.countCandidatesByRecruiters.mock.calls[0][1].visibility;
    expect(countVisibility).toEqual(queueVisibility);
  });
});
