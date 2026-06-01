import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { candidateService } from '../src/services/candidateService.js';
import { userModel } from '../src/models/User.js';
import { userService } from '../src/services/userService.js';

// PRT — recruiter choices must carry each recruiter's teamLead so the
// Add Candidate form can auto-fill the read-only Team Lead field.

const originalGetUserByEmail = userModel.getUserByEmail;
const originalCollectManageableUsers = userService.collectManageableUsers;

afterEach(() => {
  userModel.getUserByEmail = originalGetUserByEmail;
  userService.collectManageableUsers = originalCollectManageableUsers;
  jest.restoreAllMocks();
});

describe('candidateService.buildAssignablePeople — teamLead enrichment', () => {
  it('includes each recruiter\'s teamLead display name on the option', () => {
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruit.one@company.com', role: 'recruiter', active: true }
    ]);
    userModel.getUserByEmail = jest.fn((email) => {
      if ((email || '').toLowerCase() === 'recruit.one@company.com') {
        return { email, role: 'recruiter', active: true, teamLead: 'Brhamdev Sharma' };
      }
      if ((email || '').toLowerCase() === 'mam.user@company.com') {
        return { email, role: 'mam', active: true };
      }
      return { email, active: true };
    });

    const options = candidateService.buildAssignablePeople({ email: 'mam.user@company.com', role: 'mam' });
    const recruiter = options.find((o) => o.value === 'recruit.one@company.com');
    expect(recruiter).toBeTruthy();
    expect(recruiter.teamLead).toBe('Brhamdev Sharma');
  });

  it('sets teamLead to null when the recruiter has none', () => {
    userService.collectManageableUsers = jest.fn().mockReturnValue([
      { email: 'recruit.two@company.com', role: 'recruiter', active: true }
    ]);
    userModel.getUserByEmail = jest.fn((email) => ({ email, active: true }));

    const options = candidateService.buildAssignablePeople({ email: 'mam.user@company.com', role: 'mam' });
    const recruiter = options.find((o) => o.value === 'recruit.two@company.com');
    // teamLead key is omitted when the recruiter has none.
    expect(recruiter.teamLead).toBeUndefined();
  });
});
