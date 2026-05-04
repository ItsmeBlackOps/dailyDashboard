import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { UserModel } from '../src/models/User.js';

describe('UserModel cache synchronization', () => {
  let model;
  let insertOne;
  let updateOne;
  let deleteOne;
  let findOne;

  beforeEach(() => {
    model = new UserModel();
    insertOne = jest.fn().mockResolvedValue({ insertedId: 'abc123' });
    updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
    findOne = jest.fn();

    model.collection = {
      insertOne,
      updateOne,
      deleteOne,
      findOne
    };
  });

  it('writes newly created users to the cache immediately', async () => {
    await model.createUser({
      email: 'New.User@example.com',
      password: 'secret1',
      role: 'lead',
      teamLead: 'Manager Example',
      manager: 'Director Example',
      active: true
    });

    expect(insertOne).toHaveBeenCalled();
    const cached = model.cache.get('new.user@example.com');
    expect(cached).toMatchObject({
      role: 'lead',
      teamLead: 'Manager Example',
      manager: 'Director Example',
      active: true
    });
  });

  it('refreshes cache entries after updates', async () => {
    model.cache.set('lead@example.com', {
      passwordHash: 'oldhash',
      role: 'user',
      teamLead: null,
      manager: null,
      active: true
    });

    const userDoc = {
      email: 'lead@example.com',
      passwordHash: 'newhash',
      role: 'lead',
      teamLead: 'TL Example',
      manager: 'Mgr Example',
      active: false,
      profile: { location: 'Remote' },
      _id: 'xyz'
    };

    // First call: _id lookup; second call: refreshCacheForEmail
    findOne.mockResolvedValueOnce(userDoc).mockResolvedValueOnce(userDoc);

    await model.updateUser('Lead@example.com', { role: 'lead', active: false });

    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'xyz' },
      expect.objectContaining({
        $set: expect.objectContaining({ role: 'lead', active: false })
      })
    );
    expect(findOne).toHaveBeenCalledWith(
      { email: 'lead@example.com' },
      expect.objectContaining({ projection: expect.objectContaining({ _id: 1 }) })
    );
    expect(model.cache.get('lead@example.com')).toMatchObject({
      passwordHash: 'newhash',
      role: 'lead',
      teamLead: 'TL Example',
      manager: 'Mgr Example',
      active: false,
      profile: { location: 'Remote' }
    });
  });

  it('removes cache entries when users are deleted', async () => {
    model.cache.set('remove@example.com', { role: 'user' });

    findOne.mockResolvedValueOnce({ _id: 'remove-id', email: 'remove@example.com' });

    await model.deleteUser('Remove@example.com');

    expect(deleteOne).toHaveBeenCalledWith({ _id: 'remove-id' });
    expect(model.cache.has('remove@example.com')).toBe(false);
  });
});
