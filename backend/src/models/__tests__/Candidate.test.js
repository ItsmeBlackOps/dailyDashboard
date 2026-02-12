import { jest } from '@jest/globals';

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

const { CandidateModel } = await import('../Candidate.js');

describe('CandidateModel.createCandidate', () => {
  it('defaults status to active when not provided', async () => {
    const model = new CandidateModel();
    const insertOne = jest.fn().mockResolvedValue({ insertedId: 'cand-1' });
    const findOne = jest.fn().mockResolvedValue({ _id: 'cand-1' });

    model.collection = {
      insertOne,
      findOne
    };

    await model.createCandidate({ name: 'Test Candidate', email: 'test@example.com' });

    expect(insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'active'
      })
    );
  });
});
