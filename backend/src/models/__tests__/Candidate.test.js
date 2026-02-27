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

describe('CandidateModel.updateCandidateById', () => {
  it('maps updates.branch to Branch persistence field', async () => {
    const model = new CandidateModel();
    const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1 });
    const findOne = jest.fn().mockResolvedValue({
      _id: { toString: () => 'cand-2' },
      Branch: 'LKN',
      Recruiter: 'recruiter@example.com',
      Expert: '',
      Technology: 'React',
      'Candidate Name': 'Test Candidate',
      'Email ID': 'test@example.com',
      'Contact No': '',
      workflowStatus: 'awaiting_expert',
      resumeUnderstandingStatus: 'pending',
      resumeLink: ''
    });

    model.collection = {
      updateOne,
      findOne
    };

    await model.updateCandidateById('65f1b48a9c6c1c0b2e5f2e31', { branch: 'LKN' });

    expect(updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          Branch: 'LKN'
        })
      })
    );
  });
});
