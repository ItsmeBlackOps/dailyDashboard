import { describe, it, expect, jest } from '@jest/globals';
import { CandidateModel } from '../src/models/Candidate.js';

describe('CandidateModel.upsertUserProfileMetadata', () => {
  it('omits $setOnInsert when upsert is disabled', async () => {
    const model = new CandidateModel();

    model.collection = {
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 })
    };

    await expect(
      model.upsertUserProfileMetadata(
        'user@example.com',
        { displayName: 'Test User' },
        { upsert: false }
      )
    ).resolves.toBeDefined();

    const call = model.collection.updateOne.mock.calls[0];
    expect(call).toBeDefined();

    const [, updateDoc, options] = call;

    expect(updateDoc.$set).toMatchObject({
      metadata: { displayName: 'Test User' },
      email: 'user@example.com',
      docType: 'userProfile'
    });
    expect(updateDoc.$setOnInsert).toBeUndefined();
    expect(options).toMatchObject({ upsert: false });
  });
});
