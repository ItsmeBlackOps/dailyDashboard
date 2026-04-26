import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { UserModel } from '../src/models/User.js';

describe('UserModel profile metadata helpers', () => {
  let model;
  let findOne;
  let updateOne;

  beforeEach(() => {
    model = new UserModel();
    findOne = jest.fn();
    updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    model.collection = {
      findOne,
      updateOne
    };
  });

  it('returns metadata payload when profile exists', async () => {
    const createdAt = new Date('2024-01-01T00:00:00.000Z');
    const updatedAt = new Date('2024-01-02T00:00:00.000Z');

    findOne.mockResolvedValueOnce({
      email: 'user@example.com',
      profile: { displayName: 'User Example', jobRole: 'Recruiter' },
      createdAt,
      updatedAt
    });

    const result = await model.getUserProfileMetadata('User@Example.com');

    expect(findOne).toHaveBeenCalledWith(
      { email: 'user@example.com' },
      expect.objectContaining({
        projection: expect.objectContaining({ profile: 1 })
      })
    );
    expect(result).toEqual({
      email: 'user@example.com',
      metadata: { displayName: 'User Example', jobRole: 'Recruiter' },
      created_at: createdAt,
      updated_at: updatedAt
    });
  });

  it('returns null when user is missing', async () => {
    findOne.mockResolvedValueOnce(null);

    const result = await model.getUserProfileMetadata('missing@example.com');

    expect(result).toBeNull();
  });

  it('updates profile metadata and refreshes cache', async () => {
    findOne.mockResolvedValueOnce({ email: 'user@example.com', _id: 'user-id-1' });

    model.cache.set('user@example.com', {
      role: 'user',
      teamLead: null
    });

    await model.upsertUserProfileMetadata('User@example.com', {
      displayName: 'User Example',
      jobRole: 'Recruiter'
    });

    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'user-id-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          profile: expect.objectContaining({
            displayName: 'User Example',
            jobRole: 'Recruiter',
            updatedAt: expect.any(Date)
          })
        })
      })
    );

    const cached = model.cache.get('user@example.com');
    expect(cached.profile).toMatchObject({
      displayName: 'User Example',
      jobRole: 'Recruiter'
    });
  });

  it('throws when attempting to store metadata for missing user', async () => {
    findOne.mockResolvedValueOnce(null);

    await expect(
      model.upsertUserProfileMetadata('missing@example.com', { displayName: 'Nobody' })
    ).rejects.toMatchObject({
      message: 'User not found',
      statusCode: 404
    });
    expect(updateOne).not.toHaveBeenCalled();
  });
});
