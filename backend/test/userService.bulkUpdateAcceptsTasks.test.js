import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { UserService } from '../src/services/userService.js';

// bulkUpdateUsers persists `acceptsTasks` the same way it persists
// `active`: an explicit boolean on the entry is copied into the per-user
// update payload and flushed via userModel.updateUser. These tests use
// the model-mock pattern (no live DB) — an admin actor + recruiter target
// keeps the role/teamLead gates trivially satisfied so we isolate the
// acceptsTasks branch. (Atlas is unreachable in CI; this stays offline.)

const service = new UserService();
const originalUserModel = service.userModel;
const originalRefreshTokenModel = service.refreshTokenModel;

function mockModels(targetUser) {
  const updateUser = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  const getUserByEmail = jest.fn().mockReturnValue(targetUser);
  const revokeAllTokensForUser = jest.fn().mockResolvedValue(0);

  service.userModel = { getUserByEmail, updateUser };
  service.refreshTokenModel = { revokeAllTokensForUser };
  return { updateUser, getUserByEmail, revokeAllTokensForUser };
}

afterEach(() => {
  service.userModel = originalUserModel;
  service.refreshTokenModel = originalRefreshTokenModel;
  jest.restoreAllMocks();
});

describe('UserService.bulkUpdateUsers — acceptsTasks', () => {
  const admin = { email: 'admin@example.com', role: 'admin' };
  // Recruiter with no teamLead → validateTeamLeadCompatibility short-circuits
  // to { valid: true }, so the only change under test is acceptsTasks.
  const target = { email: 'recruiter@example.com', role: 'recruiter', teamLead: '' };

  it('persists acceptsTasks:true into the update payload', async () => {
    const { updateUser } = mockModels(target);

    const result = await service.bulkUpdateUsers(admin, [
      { email: 'recruiter@example.com', acceptsTasks: true },
    ]);

    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenCalledWith('recruiter@example.com', { acceptsTasks: true });
    expect(result.success).toBe(true);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toMatchObject({
      email: 'recruiter@example.com',
      appliedChanges: ['acceptsTasks'],
    });
    expect(result.failures).toHaveLength(0);
  });

  it('persists acceptsTasks:false into the update payload', async () => {
    const { updateUser } = mockModels(target);

    await service.bulkUpdateUsers(admin, [
      { email: 'recruiter@example.com', acceptsTasks: false },
    ]);

    expect(updateUser).toHaveBeenCalledWith('recruiter@example.com', { acceptsTasks: false });
  });

  it('applies acceptsTasks alongside active in a single entry', async () => {
    const { updateUser } = mockModels(target);

    await service.bulkUpdateUsers(admin, [
      { email: 'recruiter@example.com', active: true, acceptsTasks: true },
    ]);

    expect(updateUser).toHaveBeenCalledWith('recruiter@example.com', {
      active: true,
      acceptsTasks: true,
    });
  });

  it('ignores a non-boolean acceptsTasks (no change persisted)', async () => {
    const { updateUser } = mockModels(target);

    // A non-boolean acceptsTasks must not land in the payload. With no
    // other fields this entry has nothing to apply → it fails per-entry
    // with "No changes provided" rather than writing a junk value.
    const result = await service.bulkUpdateUsers(admin, [
      { email: 'recruiter@example.com', acceptsTasks: 'yes' },
    ]);

    expect(updateUser).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.updates).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].error).toMatch(/No changes provided/i);
  });
});
